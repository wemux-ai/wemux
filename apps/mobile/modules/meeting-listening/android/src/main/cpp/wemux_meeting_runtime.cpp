#include <jni.h>
#include <android/log.h>

#include "common.hpp"
#include "llama.h"
#include "moss_transcribe_capi.h"

#include <algorithm>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr char kLogTag[] = "WemuxMeetingRuntime";

void moss_log_callback(mt::mt_log_level level, const char *message, void *) {
    const auto priority = level == mt::MT_LOG_ERROR ? ANDROID_LOG_ERROR
        : level == mt::MT_LOG_WARN ? ANDROID_LOG_WARN
        : level == mt::MT_LOG_DEBUG ? ANDROID_LOG_DEBUG
        : ANDROID_LOG_INFO;
    __android_log_print(priority, kLogTag, "%s", message ? message : "");
}

struct Runtime {
    std::mutex mutex;
    bool backend_initialized = false;
    moss_transcribe_ctx * moss = nullptr;
    llama_model * value_model = nullptr;
    std::string moss_path;
    std::string value_path;
    std::string last_error;

    ~Runtime() {
        if (moss) moss_transcribe_capi_free(moss);
        if (value_model) llama_model_free(value_model);
        if (backend_initialized) llama_backend_free();
    }
};

Runtime & runtime() {
    static Runtime instance;
    return instance;
}

void set_error(Runtime &state, const std::string &message) {
    state.last_error = message;
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "%s", message.c_str());
}

std::string from_jstring(JNIEnv *env, jstring value) {
    if (!value) return {};
    const char *raw = env->GetStringUTFChars(value, nullptr);
    std::string result = raw ? raw : "";
    if (raw) env->ReleaseStringUTFChars(value, raw);
    return result;
}

jstring to_jstring(JNIEnv *env, const std::string &value) {
    return env->NewStringUTF(value.c_str());
}

int thread_count() {
    const auto cores = static_cast<int>(std::thread::hardware_concurrency());
    return std::clamp(cores > 2 ? cores - 2 : cores, 2, 6);
}

std::vector<llama_token> tokenize(const llama_vocab *vocab, const std::string &text) {
    const int32_t required = llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()), nullptr, 0, true, true);
    if (required >= 0) return {};
    std::vector<llama_token> tokens(static_cast<size_t>(-required));
    const int32_t written = llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()), tokens.data(), required * -1, true, true);
    if (written < 0) return {};
    tokens.resize(static_cast<size_t>(written));
    return tokens;
}

bool has_complete_json_object(const std::string &value) {
    int depth = 0;
    bool seen_object = false;
    bool in_string = false;
    bool escaped = false;
    for (const char character : value) {
        if (in_string) {
            if (escaped) escaped = false;
            else if (character == '\\') escaped = true;
            else if (character == '"') in_string = false;
            continue;
        }
        if (character == '"') in_string = true;
        else if (character == '{') { ++depth; seen_object = true; }
        else if (character == '}' && depth > 0 && --depth == 0 && seen_object) return true;
    }
    return false;
}

std::string conservative_fallback_verdict(const std::string &transcript) {
    static const char *keywords[] = {
        "决定", "确认", "承诺", "待办", "完成", "截止", "发布", "客户", "竞品", "风险", "负责人", "上线",
    };
    for (const char *keyword : keywords) {
        if (transcript.find(keyword) != std::string::npos) {
            return R"({"valuable":true,"valueLabel":"meeting-signal","confidence":0.35,"channels":["cloud_db","cloud_agent"]})";
        }
    }
    return R"({"valuable":false,"valueLabel":null,"confidence":0.2,"channels":[]})";
}

std::string format_value_prompt(Runtime &state, const std::string &transcript, const std::string &brain_context) {
    const std::string system =
        "你是工作会议的本地隐私价值过滤器。只输出一个 JSON 对象，不要解释。"
        "JSON 格式为：{\"valuable\":false,\"valueLabel\":null,\"confidence\":0.0,\"channels\":[]}。"
        "只有明确的工作决定、承诺、待办、风险、客户或竞品事实才是 valuable=true；"
        "闲聊、天气、饮食、情绪和不明确讨论必须为 false。"
        "true 时 channels 必须包含 cloud_db 和 cloud_agent，false 时 channels 必须为空。";
    const std::string user = "组织背景：" + brain_context.substr(0, 8000) + "\n转写：" + transcript + "\n/no_think";
    const llama_chat_message messages[] = {
        {"system", system.c_str()},
        {"user", user.c_str()},
    };
    const char *chat_template = llama_model_chat_template(state.value_model, nullptr);
    const int32_t required = llama_chat_apply_template(chat_template, messages, 2, true, nullptr, 0);
    if (required <= 0) {
        set_error(state, "MiniCPM5 chat template is unsupported");
        return {};
    }
    std::string prompt(static_cast<size_t>(required), '\0');
    const int32_t written = llama_chat_apply_template(
        chat_template, messages, 2, true, prompt.data(), required);
    if (written != required) {
        set_error(state, "MiniCPM5 chat template formatting failed");
        return {};
    }
    return prompt;
}

std::string generate_value(Runtime &state, const std::string &prompt, const std::string &transcript) {
    if (!state.value_model) {
        set_error(state, "MiniCPM5 model is not loaded");
        return {};
    }
    const llama_vocab *vocab = llama_model_get_vocab(state.value_model);
    const auto prompt_tokens = tokenize(vocab, prompt);
    if (prompt_tokens.empty()) {
        set_error(state, "MiniCPM5 prompt tokenization failed");
        return {};
    }

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = std::min<uint32_t>(4096, static_cast<uint32_t>(prompt_tokens.size() + 256));
    context_params.n_batch = static_cast<uint32_t>(prompt_tokens.size());
    context_params.n_threads = thread_count();
    context_params.n_threads_batch = context_params.n_threads;
    context_params.no_perf = true;
    llama_context *context = llama_init_from_model(state.value_model, context_params);
    if (!context) {
        set_error(state, "MiniCPM5 context creation failed");
        return {};
    }

    llama_sampler *sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    // Keep Android on the same crash-resistant path as desktop. Some
    // llama.cpp builds abort inside grammar_accept_token; malformed model
    // output is validated below and conservatively filtered instead.
    llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
    llama_batch batch = llama_batch_get_one(const_cast<llama_token *>(prompt_tokens.data()), static_cast<int32_t>(prompt_tokens.size()));
    std::string output;
    int generated_tokens = 0;
    bool failed = llama_decode(context, batch) != 0;
    for (int generated = 0; !failed && generated < 180; ++generated) {
        const llama_token token = llama_sampler_sample(sampler, context, -1);
        if (llama_vocab_is_eog(vocab, token)) {
            if (output.empty()) failed = true;
            break;
        }
        generated_tokens += 1;
        char piece[256];
        const int32_t length = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (length < 0) { failed = true; break; }
        output.append(piece, static_cast<size_t>(length));
        if (has_complete_json_object(output)) break;
        llama_sampler_accept(sampler, token);
        batch = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
        failed = llama_decode(context, batch) != 0;
    }
    llama_sampler_free(sampler);
    llama_free(context);
    if (failed) {
        return conservative_fallback_verdict(transcript);
    }
    if (output.empty() || !has_complete_json_object(output)) {
        return conservative_fallback_verdict(transcript);
    }
    __android_log_print(
        ANDROID_LOG_INFO, kLogTag, "MiniCPM5 generated %d tokens (%zu bytes)",
        generated_tokens, output.size());
    state.last_error.clear();
    return output;
}

} // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_meetinglistening_NativeMeetingRuntime_nativeLoad(
    JNIEnv *env, jobject, jstring moss_path, jstring value_path) {
    Runtime &state = runtime();
    std::lock_guard<std::mutex> guard(state.mutex);
    const std::string moss_file = from_jstring(env, moss_path);
    const std::string value_file = from_jstring(env, value_path);
    if (moss_file.empty() || value_file.empty()) {
        set_error(state, "both local model paths are required");
        return JNI_FALSE;
    }
    if (state.moss && state.value_model && state.moss_path == moss_file && state.value_path == value_file) return JNI_TRUE;

    if (!state.backend_initialized) {
        mt::set_log_callback(moss_log_callback, nullptr);
        llama_backend_init();
        state.backend_initialized = true;
    }
    if (state.moss) { moss_transcribe_capi_free(state.moss); state.moss = nullptr; }
    if (state.value_model) { llama_model_free(state.value_model); state.value_model = nullptr; }

    state.moss = moss_transcribe_capi_load(moss_file.c_str());
    if (!state.moss) {
        set_error(state, "MOSS GGUF could not be loaded");
        return JNI_FALSE;
    }
    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    state.value_model = llama_model_load_from_file(value_file.c_str(), model_params);
    if (!state.value_model) {
        moss_transcribe_capi_free(state.moss);
        state.moss = nullptr;
        set_error(state, "MiniCPM5 GGUF could not be loaded");
        return JNI_FALSE;
    }
    state.moss_path = moss_file;
    state.value_path = value_file;
    state.last_error.clear();
    __android_log_print(ANDROID_LOG_INFO, kLogTag, "local meeting models loaded");
    return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_meetinglistening_NativeMeetingRuntime_nativeIsReady(JNIEnv *, jobject) {
    Runtime &state = runtime();
    std::lock_guard<std::mutex> guard(state.mutex);
    return state.moss && state.value_model ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_meetinglistening_NativeMeetingRuntime_nativeTranscribeWav(
    JNIEnv *env, jobject, jstring wav_path) {
    Runtime &state = runtime();
    std::lock_guard<std::mutex> guard(state.mutex);
    if (!state.moss) { set_error(state, "MOSS model is not loaded"); return nullptr; }
    const std::string path = from_jstring(env, wav_path);
    char *result = moss_transcribe_capi_transcribe_path(state.moss, path.c_str(), 1024);
    if (!result) {
        set_error(state, moss_transcribe_capi_last_error(state.moss));
        return nullptr;
    }
    const std::string text(result);
    moss_transcribe_capi_free_string(result);
    return to_jstring(env, text);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_meetinglistening_NativeMeetingRuntime_nativeJudge(
    JNIEnv *env, jobject, jstring transcript, jstring brain_context) {
    Runtime &state = runtime();
    std::lock_guard<std::mutex> guard(state.mutex);
    const std::string text = from_jstring(env, transcript);
    const std::string context = from_jstring(env, brain_context);
    const std::string prompt = format_value_prompt(state, text, context);
    if (prompt.empty()) return nullptr;
    const std::string result = generate_value(state, prompt, text);
    return result.empty() ? nullptr : to_jstring(env, result);
}

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_meetinglistening_NativeMeetingRuntime_nativeLastError(JNIEnv *env, jobject) {
    Runtime &state = runtime();
    std::lock_guard<std::mutex> guard(state.mutex);
    return to_jstring(env, state.last_error);
}
