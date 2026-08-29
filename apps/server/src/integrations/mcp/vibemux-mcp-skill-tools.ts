import { z } from 'zod'
import { VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS } from '@shared/mcp'
import { listSkills, getSkill, deleteSkill } from '../../repositories/skill'
import { resolvePrimaryAgentSkills, resolveRuntimeSkillPackages } from '../../services/skill-service'
import { ErrorCode, McpError, type McpServer } from './sdk'
import { toToolResult, type VibemuxMcpContext } from './vibemux-mcp-context'

const summarizeSkill = (skill: ReturnType<typeof listSkills>[number]) => ({
  id: skill.id,
  name: skill.name,
  slug: skill.slug,
  description: skill.description,
  enabled: skill.enabled,
  sourceType: skill.sourceType,
  sourceLocator: skill.sourceLocator,
  sourceRef: skill.sourceRef,
  trustLevel: skill.trustLevel,
  compatibility: skill.compatibility,
  ownerUserId: skill.ownerUserId,
  workspaceId: skill.workspaceId,
  visibility: skill.visibility,
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
})

export const registerVibemuxMcpSkillTools = (server: McpServer, ctx: VibemuxMcpContext) => {
  // ===== skill.list =====
  server.registerTool('skill.list', {
    title: 'Skill List',
    description: '列出可用的 Skill。可按 projectId 过滤项目级 skill。',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      projectId: z.string().trim().optional().describe('可选，按项目 ID 过滤'),
    },
  }, async ({ projectId }) => {
    const userId = ctx.userId
    const skills = resolvePrimaryAgentSkills({
      projectId: projectId || undefined,
      userId,
    })

    return toToolResult({
      total: skills.length,
      skills: skills.map(summarizeSkill),
    })
  })

  // ===== skill.get =====
  server.registerTool('skill.get', {
    title: 'Skill Detail',
    description: '读取单个 Skill 的详情及文件列表',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      skillId: z.string().min(1).describe('Skill ID'),
    },
  }, async ({ skillId }) => {
    const skill = getSkill(skillId)
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, 'Skill 不存在。')
    }

    return toToolResult({
      skill: summarizeSkill(skill),
      fileInventory: skill.fileInventory ?? [],
    })
  })

  // ===== skill.runtime_packages =====
  server.registerTool('skill.runtime_packages', {
    title: 'Skill Runtime Packages',
    description: '获取当前上下文下会发送给 worker 的 skill 运行时包',
    annotations: VIBEMUX_READ_ONLY_MCP_TOOL_ANNOTATIONS,
    inputSchema: {
      projectId: z.string().trim().optional(),
      workspaceId: z.string().trim().optional(),
    },
  }, async ({ projectId, workspaceId }) => {
    const userId = ctx.userId
    const packages = resolveRuntimeSkillPackages({
      projectId: projectId || undefined,
      workspaceId: workspaceId || undefined,
      userId,
    })

    return toToolResult({
      total: packages.length,
      packages: packages.map((p) => ({
        name: p.name,
        fileCount: Object.keys(p.files).length,
        files: Object.entries(p.files).map(([path, content]) => ({
          path,
          encoding: content.encoding,
        })),
      })),
    })
  })

  // ===== skill.delete =====
  server.registerTool('skill.delete', {
    title: 'Skill Delete',
    description: '删除一个 Skill',
    inputSchema: {
      skillId: z.string().min(1).describe('Skill ID'),
    },
  }, async ({ skillId }) => {
    const skill = getSkill(skillId)
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, 'Skill 不存在。')
    }

    deleteSkill(skillId)
    return toToolResult({ ok: true, deletedId: skillId })
  })
}
