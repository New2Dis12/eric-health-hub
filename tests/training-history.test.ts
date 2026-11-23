import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PGlite } from '@electric-sql/pglite'
import { createTrainingHistoryReader } from '../lib/training/history'
import { createEricHealthMcpServer } from '../lib/mcp-server'
import type { TrainingDatabase, Queryable } from '../lib/training/database'
import type { TrainingPrincipal } from '../lib/training/auth'
import { ApiError } from '../lib/private-api'

const db = new PGlite()
const owner = 'auth0|issue59-synthetic-owner'
const other = 'auth0|issue59-synthetic-other'
const principal: TrainingPrincipal = { subject: owner, source: 'api', scopes: ['training.read'] }
const database: TrainingDatabase = {
  transaction: (subject, work) => db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE stunna_runtime')
    await tx.query("SELECT set_config('stunna.subject',$1,true)", [subject])
    return work(tx as Queryable)
  }),
}
const read = createTrainingHistoryReader(() => database)
const fixture = (name: string) => readFile(new URL('../db/migrations/' + name + '.up.sql', import.meta.url), 'utf8')
const reject = (n: number) => (error: unknown) => error instanceof ApiError && error.status === n

before(async () => {
  process.env.STUNNA_ENABLED = 'true'
  proces¶»§q«^