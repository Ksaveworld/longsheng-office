// Reuses the icon / content / sequence and expandable evidence layout from
// platform-demo/web/src/RunsPage.jsx, adapted there from Mercedes ExecutionLogPanel.
// Only persisted tool results are shown; no timer-driven steps or inferred success.
import { CheckCircle2, Circle, ShieldCheck, XCircle } from 'lucide-react'
import { showValue, type Run } from './types'

const names: Record<string, string> = {
  search_documents: '检索来源资料',
  analyze_impact: '计算到料影响',
  get_decisions: '核对会议决定',
  query_objects: '读取业务对象',
  query_relations: '追溯对象关系',
  preview_action: '检查待确认操作',
}
export function ExecutionTrace({ run }: { run: Run }) {
  return (
    <details className='rounded-lg border p-4'>
      <summary className='cursor-pointer text-sm text-muted-foreground'>
        查看运行详情
      </summary>
      <dl className='mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-xs'>
        <div>
          <dt className='text-muted-foreground'>运行方式</dt>
          <dd className='mt-1'>
            {run.mode === 'live' ? '真实模型' : '规则演示'}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>运行状态</dt>
          <dd className='mt-1'>{run.status === 'failed' ? '失败' : '完成'}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>模型</dt>
          <dd className='mt-1 break-all'>{run.model || '—'}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>耗时</dt>
          <dd className='mt-1'>{(run.latencyMs / 1000).toFixed(1)} 秒</dd>
        </div>
      </dl>
      <p className='mt-5 border-t pt-4 text-xs text-muted-foreground'>
        工具调用 · {run.toolCalls.length} 次
      </p>
      <ol className='mt-5 space-y-5'>
        {run.toolCalls.map((entry, index) => {
          const result =
            entry.result && typeof entry.result === 'object'
              ? (entry.result as Record<string, unknown>)
              : {}
          const failed = !!result.error
          const preview = entry.name === 'preview_action'
          const denied = preview && result.allowed === false
          const Icon = failed ? XCircle : preview ? ShieldCheck : CheckCircle2
          const label = failed
            ? '调用失败'
            : denied
              ? '未满足执行条件'
              : preview
                ? '仅预览，尚未执行'
                : '已返回数据'
          return (
            <li key={`${index}:${entry.name}`} className='flex min-w-0 gap-3'>
              <Icon
                className={`mt-1 size-4 shrink-0 ${failed || denied ? 'text-destructive' : 'text-muted-foreground'}`}
              />
              <details className='min-w-0 flex-1'>
                <summary className='cursor-pointer text-sm'>
                  <span className='font-medium'>
                    {names[entry.name] || entry.name}
                  </span>
                  <span className='ms-2 text-xs text-muted-foreground'>
                    {label}
                  </span>
                </summary>
                {(result.reason || failed) && (
                  <p className='mt-2 text-sm text-muted-foreground'>
                    {showValue(result.reason || result.error)}
                  </p>
                )}
                <div className='mt-3 grid min-w-0 gap-3'>
                  <div>
                    <p className='text-xs text-muted-foreground'>
                      实际调用参数
                    </p>
                    <pre className='mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-3 text-xs leading-5 break-all whitespace-pre-wrap'>
                      {showValue(entry.args)}
                    </pre>
                  </div>
                  <div>
                    <p className='text-xs text-muted-foreground'>
                      实际返回结果
                    </p>
                    <pre className='mt-1 max-h-64 overflow-auto rounded bg-muted/40 p-3 text-xs leading-5 break-all whitespace-pre-wrap'>
                      {showValue(entry.result)}
                    </pre>
                  </div>
                </div>
                <p className='mt-2 text-xs text-muted-foreground'>
                  {entry.startedAt
                    ? new Date(entry.startedAt).toLocaleString('zh-CN')
                    : '旧记录未保存单步时间'}
                  {entry.latencyMs !== undefined
                    ? ` · 工具处理 ${entry.latencyMs} ms`
                    : ''}
                </p>
              </details>
              <span
                aria-label={`第 ${index + 1} 个已保存调用`}
                className='text-xs text-muted-foreground tabular-nums'
              >
                {String(index + 1).padStart(2, '0')}
              </span>
            </li>
          )
        })}
        {!run.toolCalls.length && (
          <li className='flex gap-3 text-sm text-muted-foreground'>
            <Circle className='size-4' />
            没有保存工具调用。
          </li>
        )}
      </ol>
      <p className='mt-5 border-t pt-3 text-xs text-muted-foreground'>
        数据 v{run.revision} · {new Date(run.createdAt).toLocaleString('zh-CN')}
        <br />
        <span className='break-all'>运行 {run.id}</span>
      </p>
    </details>
  )
}
