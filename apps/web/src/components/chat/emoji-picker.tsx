/**
 * [INPUT]: 群聊输入框 / 表情回复选择触发。
 * [OUTPUT]: 轻量 emoji 面板（分类 + 搜索 + 点击回调）。
 * [POS]: 自研精简 emoji 选择器；避免引入 emoji-mart 等重依赖，数据内嵌常用集。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
 */
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '../ui/input'

export interface EmojiEntry {
  emoji: string
  /** 中文关键词（搜索用） */
  zh: string
  /** 英文关键词（搜索用） */
  en: string
}

export const EMOJI_GROUPS: Array<{ label: string; entries: EmojiEntry[] }> = [
  {
    label: '表情',
    entries: [
      { emoji: '😀', zh: '开心 微笑 大笑', en: 'grinning smile laugh' },
      { emoji: '😄', zh: '开心 露齿笑', en: 'smile grin' },
      { emoji: '😁', zh: '开心 露齿笑', en: 'grin happy' },
      { emoji: '😆', zh: '大笑 眯眼笑', en: 'laugh joy' },
      { emoji: '😅', zh: '尴尬笑 汗', en: 'sweat smile' },
      { emoji: '😂', zh: '笑哭 流泪', en: 'joy tears laugh' },
      { emoji: '🤣', zh: '笑到打滚', en: 'rofl laugh' },
      { emoji: '🙂', zh: '微笑 礼貌', en: 'slight smile' },
      { emoji: '🙃', zh: '倒立 调皮', en: 'upside down silly' },
      { emoji: '😉', zh: '眨眼 调皮', en: 'wink' },
      { emoji: '😊', zh: '微笑 害羞', en: 'blush smile' },
      { emoji: '😇', zh: '天使 无辜', en: 'innocent angel' },
      { emoji: '😍', zh: '喜爱 红心眼', en: 'heart eyes love' },
      { emoji: '🥰', zh: '喜爱 三心', en: 'smiling hearts love' },
      { emoji: '😘', zh: '飞吻', en: 'kiss blowing' },
      { emoji: '😗', zh: '亲亲', en: 'kissing' },
      { emoji: '😋', zh: '美味 馋', en: 'yum tasty' },
      { emoji: '😛', zh: '吐舌 调皮', en: 'tongue silly' },
      { emoji: '😜', zh: '眨眼吐舌', en: 'winking tongue' },
      { emoji: '🤪', zh: '疯狂 搞怪', en: 'zany crazy' },
      { emoji: '🤨', zh: '怀疑 挑眉', en: 'raised eyebrow doubt' },
      { emoji: '🧐', zh: '检查 仔细看', en: 'monocle inspect' },
      { emoji: '🤓', zh: '书呆子', en: 'nerd' },
      { emoji: '😎', zh: '酷 墨镜', en: 'sunglasses cool' },
      { emoji: '🥳', zh: '庆祝 派对', en: 'party celebrate' },
      { emoji: '🤗', zh: '拥抱', en: 'hug' },
      { emoji: '🤔', zh: '思考', en: 'thinking think' },
      { emoji: '🤭', zh: '捂嘴笑 偷笑', en: 'hand over mouth giggle' },
      { emoji: '🤫', zh: '嘘 安静', en: 'shushing quiet' },
      { emoji: '😶', zh: '无语 沉默', en: 'no mouth silent' },
      { emoji: '😐', zh: '面无表情', en: 'neutral straight face' },
      { emoji: '😑', zh: '无语 面无表情', en: 'expressionless' },
      { emoji: '😬', zh: '尴尬 龇牙', en: 'grimace awkward' },
      { emoji: '😴', zh: '困 睡觉', en: 'sleeping tired' },
      { emoji: '😪', zh: '困 犯困', en: 'sleepy' },
      { emoji: '😌', zh: '安心 放松', en: 'relieved relaxed' },
      { emoji: '😔', zh: '难过 沉思', en: 'pensive sad' },
      { emoji: '😕', zh: '困惑 不满', en: 'confused' },
      { emoji: '🙁', zh: '不开心 沮丧', en: 'slightly frowning' },
      { emoji: '☹️', zh: '沮丧 皱眉', en: 'frowning sad' },
      { emoji: '😣', zh: '痛苦 勉强', en: 'persevere struggle' },
      { emoji: '😖', zh: '窘迫 抓狂', en: 'anguish' },
      { emoji: '😫', zh: '累 崩溃', en: 'tired weary' },
      { emoji: '😩', zh: '无奈 精疲力尽', en: 'weary exhausted' },
      { emoji: '🥺', zh: '委屈 求求', en: 'pleading puppy eyes' },
      { emoji: '😢', zh: '哭 难过', en: 'cry tears' },
      { emoji: '😭', zh: '大哭 泪流', en: 'sob crying' },
      { emoji: '😤', zh: '生气 哼', en: 'triumph angry' },
      { emoji: '😠', zh: '生气 愤怒', en: 'angry' },
      { emoji: '😡', zh: '暴怒 红脸', en: 'pouting rage' },
      { emoji: '🤬', zh: '骂人 脏话', en: 'cursing swear' },
      { emoji: '🤯', zh: '震惊 炸头', en: 'exploding head shocked' },
      { emoji: '😳', zh: '脸红 尴尬', en: 'flushed embarrassed' },
      { emoji: '🥵', zh: '热 出汗', en: 'hot sweaty' },
      { emoji: '🥶', zh: '冷 冻', en: 'cold freezing' },
      { emoji: '😱', zh: '惊吓 尖叫', en: 'scream scared' },
      { emoji: '😨', zh: '害怕 恐惧', en: 'fearful afraid' },
      { emoji: '😰', zh: '紧张 冷汗', en: 'anxious worried' },
      { emoji: '😥', zh: '失望 松口气', en: 'disappointed relieved' },
      { emoji: '😓', zh: '流汗 辛苦', en: 'sweat down' },
      { emoji: '🤒', zh: '生病 发烧', en: 'sick thermometer' },
      { emoji: '🤕', zh: '受伤 头带', en: 'injured bandage' },
      { emoji: '🤢', zh: '恶心 想吐', en: 'nauseated vomit' },
      { emoji: '🤮', zh: '呕吐', en: 'vomiting' },
      { emoji: '🥴', zh: '晕 醉', en: 'woozy dizzy' },
      { emoji: '😵', zh: '晕眩 眼花', en: 'dizzy' },
      { emoji: '🥱', zh: '打哈欠 困', en: 'yawning' },
      { emoji: '😷', zh: '口罩 生病', en: 'mask sick' },
      { emoji: '🤧', zh: '打喷嚏', en: 'sneeze' },
      { emoji: '😇', zh: '天使', en: 'innocent angel' },
      { emoji: '🥹', zh: '忍泪 感动', en: 'holding back tears' },
      { emoji: '🫠', zh: '融化 无奈', en: 'melting' },
      { emoji: '🫡', zh: '敬礼', en: 'salute' },
    ],
  },
  {
    label: '手势',
    entries: [
      { emoji: '👍', zh: '赞 点赞 同意', en: 'thumbs up like' },
      { emoji: '👎', zh: '踩 反对', en: 'thumbs down dislike' },
      { emoji: '👌', zh: 'OK 好', en: 'ok hand' },
      { emoji: '✌️', zh: '胜利 剪刀', en: 'victory peace' },
      { emoji: '🤞', zh: '祈祷 好运', en: 'crossed fingers luck' },
      { emoji: '🤟', zh: '爱你 摇滚', en: 'love you rock' },
      { emoji: '🤘', zh: '摇滚 金属', en: 'rock on metal' },
      { emoji: '🤙', zh: '打电话 酷', en: 'call me cool' },
      { emoji: '👈', zh: '左指', en: 'point left' },
      { emoji: '👉', zh: '右指', en: 'point right' },
      { emoji: '👆', zh: '上指', en: 'point up' },
      { emoji: '👇', zh: '下指', en: 'point down' },
      { emoji: '☝️', zh: '上指 提醒', en: 'point up index' },
      { emoji: '👋', zh: '挥手 再见', en: 'wave hello bye' },
      { emoji: '🤚', zh: '举手 停', en: 'raised hand stop' },
      { emoji: '✋', zh: '手掌 停', en: 'hand palm stop' },
      { emoji: '🖐️', zh: '张开手掌', en: 'spread hand' },
      { emoji: '👏', zh: '鼓掌 欢迎', en: 'clap applause' },
      { emoji: '🙌', zh: '举手欢呼', en: 'raising hands celebrate' },
      { emoji: '🙏', zh: '感谢 祈祷 拜托', en: 'pray thanks please' },
      { emoji: '🤝', zh: '握手 合作', en: 'handshake deal' },
      { emoji: '💪', zh: '加油 肌肉', en: 'flex muscle strong' },
      { emoji: '🖕', zh: '中指 粗鲁', en: 'middle finger rude' },
      { emoji: '🫶', zh: '爱心手势', en: 'heart hands' },
      { emoji: '🤌', zh: '捏手指 意大利', en: 'pinched fingers' },
    ],
  },
  {
    label: '爱心',
    entries: [
      { emoji: '❤️', zh: '爱心 喜欢 爱', en: 'heart love' },
      { emoji: '🧡', zh: '橙心', en: 'orange heart' },
      { emoji: '💛', zh: '黄心', en: 'yellow heart' },
      { emoji: '💚', zh: '绿心', en: 'green heart' },
      { emoji: '💙', zh: '蓝心', en: 'blue heart' },
      { emoji: '💜', zh: '紫心', en: 'purple heart' },
      { emoji: '🖤', zh: '黑心', en: 'black heart' },
      { emoji: '🤍', zh: '白心', en: 'white heart' },
      { emoji: '🤎', zh: '棕心', en: 'brown heart' },
      { emoji: '💔', zh: '碎心 伤心', en: 'broken heart' },
      { emoji: '❤️‍🔥', zh: '燃烧的心', en: 'heart on fire' },
      { emoji: '💕', zh: '两颗心 喜欢', en: 'two hearts' },
      { emoji: '💞', zh: '旋转的心', en: 'revolving hearts' },
      { emoji: '💓', zh: '心跳', en: 'beating heart' },
      { emoji: '💗', zh: '成长的心', en: 'growing heart' },
      { emoji: '💖', zh: '闪耀的心', en: 'sparkling heart' },
      { emoji: '💘', zh: '丘比特箭 恋爱', en: 'cupid arrow love' },
      { emoji: '💝', zh: '蝴蝶结礼物心', en: 'gift heart' },
      { emoji: '💟', zh: '心形符号', en: 'heart decoration' },
      { emoji: '♥️', zh: '心形', en: 'heart suit' },
      { emoji: '✨', zh: '闪耀 星星 亮', en: 'sparkles shiny' },
      { emoji: '⭐', zh: '星星', en: 'star' },
      { emoji: '🌟', zh: '闪亮星星', en: 'glowing star' },
      { emoji: '💫', zh: '晕 闪烁', en: 'dizzy sparkle' },
      { emoji: '🔥', zh: '火 热 流行', en: 'fire hot' },
    ],
  },
  {
    label: '符号',
    entries: [
      { emoji: '✅', zh: '勾 完成 对', en: 'check done yes' },
      { emoji: '❌', zh: '叉 错误 否', en: 'cross no error' },
      { emoji: '❓', zh: '问号 疑问', en: 'question mark' },
      { emoji: '❗', zh: '感叹号 注意', en: 'exclamation' },
      { emoji: '⚠️', zh: '警告 注意', en: 'warning caution' },
      { emoji: '💡', zh: '灯泡 想法 提示', en: 'bulb idea tip' },
      { emoji: '🔔', zh: '铃铛 提醒', en: 'bell notify' },
      { emoji: '🚀', zh: '火箭 发布 加速', en: 'rocket launch' },
      { emoji: '🎉', zh: '庆祝 彩带', en: 'party popper celebrate' },
      { emoji: '🎊', zh: '庆祝 拉炮', en: 'confetti celebrate' },
      { emoji: '🎯', zh: '目标 命中', en: 'target bullseye' },
      { emoji: '🏆', zh: '奖杯 胜利', en: 'trophy win' },
      { emoji: '🥇', zh: '金牌 第一', en: 'gold medal first' },
      { emoji: '🥈', zh: '银牌 第二', en: 'silver medal second' },
      { emoji: '🥉', zh: '铜牌 第三', en: 'bronze medal third' },
      { emoji: '📌', zh: '图钉 置顶', en: 'pin' },
      { emoji: '📍', zh: '定位 位置', en: 'location pin' },
      { emoji: '🔒', zh: '锁 私有 安全', en: 'lock private secure' },
      { emoji: '🔓', zh: '解锁 公开', en: 'unlock open' },
      { emoji: '🔑', zh: '钥匙 密钥', en: 'key' },
      { emoji: '📈', zh: '上升 增长', en: 'chart increasing' },
      { emoji: '📉', zh: '下降', en: 'chart decreasing' },
      { emoji: '💯', zh: '满分 100', en: 'hundred perfect' },
      { emoji: '🆕', zh: '新', en: 'new' },
      { emoji: '🆗', zh: 'OK 好', en: 'ok' },
      { emoji: '🔴', zh: '红点 直播', en: 'red circle live' },
      { emoji: '🟢', zh: '绿点 在线', en: 'green circle online' },
      { emoji: '🟡', zh: '黄点', en: 'yellow circle' },
      { emoji: '⚪', zh: '白点', en: 'white circle' },
      { emoji: '⚫', zh: '黑点', en: 'black circle' },
    ],
  },
  {
    label: '物体',
    entries: [
      { emoji: '📦', zh: '包裹 发货', en: 'package box' },
      { emoji: '📎', zh: '回形针 附件', en: 'paperclip attach' },
      { emoji: '📄', zh: '文档 文件', en: 'document file' },
      { emoji: '📁', zh: '文件夹', en: 'folder' },
      { emoji: '🗂️', zh: '卡片索引 档案', en: 'card index dividers' },
      { emoji: '📝', zh: '备忘录 笔记', en: 'memo note' },
      { emoji: '✏️', zh: '铅笔 编辑', en: 'pencil edit' },
      { emoji: '🖊️', zh: '笔', en: 'pen' },
      { emoji: '💻', zh: '电脑 笔记本', en: 'laptop computer' },
      { emoji: '🖥️', zh: '桌面电脑', en: 'desktop computer' },
      { emoji: '📱', zh: '手机', en: 'mobile phone' },
      { emoji: '☕', zh: '咖啡', en: 'coffee' },
      { emoji: '🍵', zh: '茶', en: 'tea' },
      { emoji: '🍺', zh: '啤酒', en: 'beer' },
      { emoji: '🍻', zh: '干杯', en: 'cheers' },
      { emoji: '🍰', zh: '蛋糕', en: 'cake dessert' },
      { emoji: '🍕', zh: '披萨', en: 'pizza' },
      { emoji: '🍔', zh: '汉堡', en: 'burger' },
      { emoji: '🎂', zh: '生日蛋糕', en: 'birthday cake' },
      { emoji: '⏰', zh: '闹钟 时间', en: 'alarm clock time' },
      { emoji: '📅', zh: '日历 日期', en: 'calendar date' },
      { emoji: '📆', zh: '撕页日历', en: 'tear-off calendar' },
      { emoji: '⌛', zh: '沙漏 等待', en: 'hourglass wait' },
      { emoji: '💰', zh: '钱 钱包', en: 'money bag' },
      { emoji: '💵', zh: '美元', en: 'dollar' },
      { emoji: '💳', zh: '银行卡 支付', en: 'credit card pay' },
      { emoji: '🎁', zh: '礼物', en: 'gift present' },
      { emoji: '🎈', zh: '气球', en: 'balloon' },
      { emoji: '🎬', zh: '电影 拍摄', en: 'movie clapper' },
      { emoji: '🎧', zh: '耳机', en: 'headphone music' },
      { emoji: '📷', zh: '相机 拍照', en: 'camera photo' },
      { emoji: '🔧', zh: '扳手 修理', en: 'wrench fix' },
      { emoji: '🛠️', zh: '工具', en: 'hammer wrench tools' },
      { emoji: '🧠', zh: '大脑 思考', en: 'brain think' },
      { emoji: '👀', zh: '眼睛 关注', en: 'eyes watch' },
      { emoji: '🙈', zh: '捂眼 看不见', en: 'see no evil' },
      { emoji: '🙉', zh: '捂耳 听不见', en: 'hear no evil' },
      { emoji: '🙊', zh: '捂嘴 不说', en: 'speak no evil' },
    ],
  },
]

const normalizeSearchQuery = (value: string) => value.trim().toLowerCase()

const matchEmojiEntry = (entry: EmojiEntry, query: string) => (
  entry.zh.toLowerCase().includes(query)
  || entry.en.toLowerCase().includes(query)
  || entry.emoji === query
)

/**
 * 轻量 emoji 面板。纯内容面板，由调用处包 Popover 控制开合与触发。
 */
export function EmojiPicker(props: {
  onSelect: (emoji: string) => void
  className?: string
  autoFocusSearch?: boolean
}) {
  const { onSelect, className, autoFocusSearch = false } = props
  const [query, setQuery] = useState('')

  const filteredGroups = useMemo(() => {
    const normalized = normalizeSearchQuery(query)
    if (!normalized) {
      return EMOJI_GROUPS
    }

    return EMOJI_GROUPS
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => matchEmojiEntry(entry, normalized)),
      }))
      .filter((group) => group.entries.length > 0)
  }, [query])

  const totalEntries = useMemo(
    () => filteredGroups.reduce((sum, group) => sum + group.entries.length, 0),
    [filteredGroups],
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Input
        autoFocus={autoFocusSearch}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索 emoji…"
        className="h-7 text-xs"
      />
      {totalEntries === 0 ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-500">没有匹配的 emoji。</p>
      ) : (
        <div className="max-h-56 overflow-y-auto pr-0.5">
          {filteredGroups.map((group) => (
            <div key={group.label} className="mb-1.5">
              <p className="px-1 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">{group.label}</p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.entries.map((entry) => (
                  <button
                    key={entry.emoji}
                    type="button"
                    onClick={() => {
                      onSelect(entry.emoji)
                      setQuery('')
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-zinc-800"
                    title={entry.zh}
                  >
                    {entry.emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
