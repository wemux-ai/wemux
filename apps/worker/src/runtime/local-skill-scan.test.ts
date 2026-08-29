import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { scanLocalSkills } from './local-skill-scan'

const createTempDir = (prefix: string) => mkdtemp(path.join(os.tmpdir(), prefix))

test('scanLocalSkills includes binary asset payloads for project skills', async () => {
  const rootDir = await createTempDir('vibemux-skill-project-')

  try {
    const skillDir = path.join(rootDir, 'skills', 'asset-skill')
    const assetBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

    await mkdir(path.join(skillDir, 'assets'), { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Asset Skill\n\nUses an image asset.\n')
    await writeFile(path.join(skillDir, 'assets', 'logo.png'), assetBuffer)

    const result = await scanLocalSkills({
      workspaceRoot: rootDir,
      scanMode: 'project',
      rootPath: rootDir,
    })

    assert.equal(result.ok, true)
    assert.equal(result.packages.length, 1)
    assert.deepEqual(result.packages[0]?.files['SKILL.md'], {
      encoding: 'utf8',
      content: '# Asset Skill\n\nUses an image asset.\n',
    })
    assert.deepEqual(result.packages[0]?.files['assets/logo.png'], {
      encoding: 'base64',
      content: assetBuffer.toString('base64'),
    })
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('scanLocalSkills scans ~/.pi/skills as part of global roots', async (t) => {
  const homeDir = await createTempDir('vibemux-skill-home-')

  try {
    const globalSkillDir = path.join(homeDir, '.pi', 'skills', 'pi-global-skill')
    await mkdir(globalSkillDir, { recursive: true })
    await writeFile(path.join(globalSkillDir, 'SKILL.md'), '# Pi Global Skill\n\nGlobal Pi instructions.\n')

    t.mock.method(os, 'homedir', () => homeDir)

    const result = await scanLocalSkills({
      workspaceRoot: homeDir,
      scanMode: 'global',
    })

    assert.equal(result.ok, true)
    assert.ok(result.scannedRoots.includes(path.join(homeDir, '.pi', 'skills')))
    assert.equal(result.packages.some((skill) => skill.slug === 'pi-global-skill'), true)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
