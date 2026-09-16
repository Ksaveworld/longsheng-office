import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { createOfficeServer } from '../server/office-server.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rules=process.argv.includes('--rules')
if (!rules) loadEnvFile(resolve(root, '.env.model.local'))
const server=createOfficeServer({
  dbPath:resolve(root,'.office-data/representatives-20260916/office.sqlite'),
  distPath:resolve(root,'.runtime/representative-dist'),
  defaultMode:rules?'rules':'live',
  provider:rules?{}:{baseUrl:process.env.MODEL_BASE_URL,model:process.env.MODEL_NAME,apiKey:process.env.MODEL_API_KEY},
})
server.on('error', error=>{console.error(error.message);process.exitCode=1})
server.listen(5198,'127.0.0.1',()=>console.log('http://127.0.0.1:5198/office#home'))
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)))
