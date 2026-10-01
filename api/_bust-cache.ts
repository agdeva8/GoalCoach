import { db } from './lib/db'
import { motivationCache } from './db/schema'

await db.delete(motivationCache)
console.log('cache cleared')
process.exit(0)
