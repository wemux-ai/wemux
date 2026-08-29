import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('LinuxService install restarts existing services after writing the unit', async () => {
  const source = await readFile(new URL('./linux-service.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /'enable', '--now'/)
  assert.match(source, /this\.systemctl\(\['enable', this\.unitName\(\)\]\)\n\s+this\.systemctl\(\['restart', this\.unitName\(\)\]\)/)
})
