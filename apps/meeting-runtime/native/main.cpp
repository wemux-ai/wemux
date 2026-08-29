#include "common.hpp"
#include "llama.h"
#include "moss_transcribe_capi.h"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr char kBase64Alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

struct Runtime {
    bool backend_initialized = false;
    moss_transcribe_ctx *moss = nullptr;
    llama_model *value_model = nullptr;
    std::string last_error;

    ~Runtime() {
        if (moss) moss_transcribe_capi_free(moss);
        if (value_model) llama_model_free(value_model);
        if (backend_initialized) llama_backend_free();
    }
};

void moss_log_callback(mt::mt_log_level, const char *message, void *) {
    if (message && *message) std::cerr << "[moss] " << message << '\n';
}

void set_error(Runtime &state, const std::string &message) {
    state.last_error = message;
    std::cerr << "[runtime] " << message << '\n';
}

int thread_count() {
    const auto cores = static_cast<int>(std::thread::hardware_concurrency());
    return std::clamp(cores > 2 ? cores - 2 : cores, 2, 8);
}

std::string base64_encode(const std::string &input) {
    std::string output;
    output.reserve(((input.size() + 2) / 3) * 4);
    uint32_t buffer = 0;
    int bits = -6;
    for (const unsigned char value : input) {
        buffer = (buffer << 8) | value;
        bits += 8;
        while (bits >= 0) {
            output.push_back(kBase64Alphabet[(buffer >> bits) & 0x3f]);
            bits -= 6;
        }
    }
    if (bits > -6) output.push_back(kBase64Alphabet[((buffer << 8) >> (bits + 8)) & 0x3f]);
    while (output.size() % 4) output.push_back('=');
    return output;
}

std::string base64_decode(const std::string &input) {
    static const std::vector<int> lookup = [] {
        std::vector<int> result(256, -1);
        for (int index = 0; index < 64; ++index) {
            result[static_cast<unsigned char>(kBase64Alphabet[index])] = index;
        }
        return result;
    }();
    std::string output;
    output.reserve((input.size() * 3) / 4);
    uint32_t buffer = 0;
    int bits = -8;
    for (const unsigned char value : input) {
        if (lookup[value] < 0) break;
        buffer = (buffer << 6) | static_cast<uint32_t>(lookup[value]);
        bits += 6;
        if (bits >= 0) {
            output.push_back(static_cast<char>((buffer >> bits) & 0xff));
            bits -= 8;
        }
    }
    return output;
}

std::vector<std::string> split_fields(const std::string &line) {
    std::vector<std::string> fields;
    size_t start = 0;
    while (true) {
        const size_t separator = line.find('\t', start);
        fields.push_back(line.substr(start, separator == std::string::npos ? separator : separator - start));
        if (separator == std::string::npos) break;
        start = separator + 1;
    }
    return fields;
}

void respond(const char *status, const std::string &request_id, const std::string &payload) {
    std::cout << status << '\t' << request_id << '\t' << base64_encode(payload) << '\n' << std::flush;
}

std::vector<llama_token> tokenize(const llama_vocab *vocab, const std::string &text) {
    const int32_t required = llama_tokenize(
        vocab, text.data(), static_cast<int32_t>(text.size()), nullptr, 0, true, true);
    if (required >= 0) return {};
    std::vector<llama_token> tokens(static_cast<size_t>(-required));
    const int32_t written = llama_tokenize(
        vocab, text.data(), static_cast<int32_t>(text.size()), tokens.data(), -required, true, true);
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
    bool valuable = false;
    for (const char *keyword : keywords) {
        if (transcript.find(keyword) != std::string::npos) { valuable = true; break; }
    }
    if (!valuable) return R"({"valuable":false,"valueLabel":null,"confidence":0.2,"channels":[]})";
    return R"({"valuable":true,"valueLabel":"meeting-signal","confidence":0.35,"channels":["cloud_db","cloud_agent"]})";
}

std::string format_value_prompt(Runtime &state, const std::string &transcript,
                                const std::string &brain_context) {
    const std::string system =
        "你是工作会议的本地隐私价值过滤器。只输出一个 JSON 对象，不要解释。"
        "JSON 格式为：{\"valuable\":false,\"valueLabel\":null,\"confidence\":0.0,\"channels\":[]}。"
        "只有明确的工作决定、承诺、待办、风险、客户或竞品事实才是 valuable=true；"
        "闲聊、天气、饮食、情绪和不明确讨论必须为 false。"
        "true 时 channels 必须包含 cloud_db 和 cloud_agent，false 时 channels 必须为空。";
    const std::string user = "组织背景：" + brain_context.substr(0, 8000) + "\n转写：" + transcript + "\n/no_think";
    const llama_chat_message messages[] = {{"system", system.c_str()}, {"user", user.c_str()}};
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
    // Do not use llama.cpp's grammar sampler here. Older Metal/CPU builds can
    // throw from llama_grammar_accept_token and abort the whole meeting
    // listener. The response is validated below and malformed output falls
    // back to the conservative local keyword filter.
    llama_sampler_chain_add(sampler, llama_sampler_init_greedy());
    llama_batch batch = llama_batch_get_one(
        const_cast<llama_token *>(prompt_tokens.data()), static_cast<int32_t>(prompt_tokens.size()));
    std::string output;
    int generated_tokens = 0;
    bool failed = llama_decode(context, batch) != 0;
    for (int generated = 0; !failed && generated < 180; ++generated) {
        const llama_token token = llama_sampler_sample(sampler, context, -1);
        if (llama_vocab_is_eog(vocab, token)) {
            if (output.empty()) failed = true;
            break;
        }
        char piece[256];
        const int32_t length = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (length < 0) { failed = true; break; }
        output.append(piece, static_cast<size_t>(length));
        generated_tokens += 1;
        if (has_complete_json_object(output)) break;
        llama_sampler_accept(sampler, token);
        batch = llama_batch_get_one(const_cast<llama_token *>(&token), 1);
        failed = llama_decode(context, batch) != 0;
    }
    llama_sampler_free(sampler);
    llama_free(context);
    if (failed || output.empty() || !has_complete_json_object(output)) {
        std::cerr << "[runtime] MiniCPM5 response was incomplete after "
                  << generated_tokens << " tokens; using conservative local fallback\n";
        return conservative_fallback_verdict(transcript);
    }
    state.last_error.clear();
    return output;
}

bool load_models(Runtime &state, const std::string &moss_path, const std::string &value_path) {
    mt::set_log_callback(moss_log_callback, nullptr);
    llama_backend_init();
    state.backend_initialized = true;
    state.moss = moss_transcribe_capi_load(moss_path.c_str());
    if (!state.moss) {
        set_error(state, "MOSS GGUF could not be loaded");
        return false;
    }
    llama_model_params model_params = llama_model_default_params();
    // Keep the constrained JSON decoder deterministic across desktop GPUs.
    // MOSS may use Metal internally; MiniCPM5 stays on CPU to avoid a
    // llama.cpp Metal grammar-stack issue on older SDK/runtime combinations.
    model_params.n_gpu_layers = 0;
    state.value_model = llama_model_load_from_file(value_path.c_str(), model_params);
    if (!state.value_model) {
        set_error(state, "MiniCPM5 GGUF could not be loaded");
        return false;
    }
    return true;
}

std::string transcribe(Runtime &state, const std::string &path) {
    char *result = moss_transcribe_capi_transcribe_path(state.moss, path.c_str(), 2048);
    if (!result) {
        set_error(state, moss_transcribe_capi_last_error(state.moss));
        return {};
    }
    std::string text(result);
    moss_transcribe_capi_free_string(result);
    state.last_error.clear();
    return text;
}

}  // namespace

int main(int argc, char **argv) {
    if (argc != 3) {
        std::cerr << "usage: wemux-meeting-runtime <moss.gguf> <minicpm.gguf>\n";
        return EXIT_FAILURE;
    }
    Runtime state;
    if (!load_models(state, argv[1], argv[2])) return EXIT_FAILURE;
    std::cout << "READY\n" << std::flush;

    std::string line;
    while (std::getline(std::cin, line)) {
        const auto fields = split_fields(line);
        const std::string request_id = fields.size() > 1 ? fields[1] : "unknown";
        if (fields.size() == 2 && fields[0] == "PING") {
            respond("OK", request_id, "pong");
        } else if (fields.size() == 3 && fields[0] == "TRANSCRIBE") {
            const std::string result = transcribe(state, base64_decode(fields[2]));
            if (result.empty()) respond("ERROR", request_id, state.last_error);
            else respond("OK", request_id, result);
        } else if (fields.size() == 4 && fields[0] == "JUDGE") {
            const std::string transcript = base64_decode(fields[2]);
            const std::string prompt = format_value_prompt(state, transcript, base64_decode(fields[3]));
            const std::string result = prompt.empty() ? std::string() : generate_value(state, prompt, transcript);
            if (result.empty()) respond("ERROR", request_id, state.last_error);
            else respond("OK", request_id, result);
        } else {
            respond("ERROR", request_id, "invalid runtime command");
        }
    }
    return EXIT_SUCCESS;
}
