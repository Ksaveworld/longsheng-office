import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { ExecutionCards } from './event-view'
import { ErrorNotice, Sources } from './shared'
import { roleNames, type Preview, type Snapshot, type Source } from './types'
import { ReviewSummary } from './workflow-overview'

const titles: Record<string, [string, string]> = {
  send_tasks: ['发送部门任务', '确认发送'],
  accept_task: ['确认接收任务', '确认接收'],
  select_plan: ['确认处理方案意向', '确认选择'],
  approve_keep_a: ['确认沿用供应商 A', '确认批准'],
  request_quality: ['发起方案质量核验', '确认发起'],
  approve_switch: ['批准切换', '确认批准'],
  submit_quality: ['确认方案核验结果', '确认提交'],
  submit_receipt: ['确认部门处理回执', '确认提交'],
  start_task: ['开始处理任务', '确认开始'],
  close_matter: ['复核并关闭事项', '确认关闭'],
  select_event_plan: ['选择处理方案', '确认选择'],
  request_event_review: ['发起方案核验', '确认发起'],
  approve_event: ['负责人确认方案', '确认批准'],
  retry_delivery: ['重试发送', '确认重试'],
  set_arrival: ['调整预计到料日', '确认调整'],
  arm_delivery_failure: ['设置下一次发送失败', '确认设置'],
  reset: ['重置当前演示', '确认重置'],
}
export function ActionSheet({
  preview,
  snapshot,
  busy,
  error,
  sources,
  openSource,
  close,
  confirm,
  recheck,
  viewMatter,
}: {
  preview: Preview | null
  snapshot: Snapshot | null
  busy: boolean
  error: string
  sources: Source[]
  openSource: (source: Source) => void
  close: () => void
  confirm: () => void
  recheck: () => void
  viewMatter: () => void
}) {
  const kind = preview?.action.type || ''
  const [title, confirmLabel] = titles[kind] || ['核对操作', '确认执行']
  const stale = !!preview && preview.revision !== snapshot?.state.revision
  const current = snapshot?.analysis.options.find(
    (item) => item.supplierId === 'A'
  )
  const candidate = snapshot?.analysis.options.find(
    (item) => item.supplierId === 'B'
  )
  return (
    <Sheet
      open={!!preview}
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <SheetContent className='flex w-full flex-col sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {snapshot?.state.matter.id} · {snapshot?.state.matter.materialId} ·{' '}
            {preview ? roleNames[preview.role] : ''}
          </SheetDescription>
        </SheetHeader>
        <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 text-sm'>
          {kind === 'request_quality' && (
            <>
              <dl className='grid grid-cols-[5rem_1fr] gap-3'>
                <dt className='text-muted-foreground'>接收岗位</dt>
                <dd>质量负责人</dd>
                <dt className='text-muted-foreground'>核验对象</dt>
                <dd>
                  {
                    snapshot?.state.planVersions.find(
                      (p) =>
                        p.id ===
                        snapshot.state.matter.planSelection?.planVersionId
                    )?.title
                  }{' '}
                  · {snapshot?.state.matter.materialId}
                </dd>
                <dt className='text-muted-foreground'>发起依据</dt>
                <dd className='leading-6'>
                  核对当前选中版本的订单影响与实施条件，记录人工结论及凭据。
                </dd>
                <dt className='text-muted-foreground'>完成要求</dt>
                <dd>提交通过或不通过结论，并附核验依据。</dd>
              </dl>
              <div className='rounded-md bg-muted/40 p-4 leading-7'>
                确认后将核验任务交给质量负责人，当前供应决定仍为{' '}
                {snapshot?.analysis.effectiveDecisionId}。
              </div>
            </>
          )}
          {kind === 'approve_switch' && (
            <>
              <div className='grid grid-cols-2 gap-3'>
                <div className='rounded-lg border p-4'>
                  <p className='text-muted-foreground'>当前路径 · 供应商 A</p>
                  <p className='mt-3 text-xl font-semibold'>
                    D{current?.arrivalDay}
                  </p>
                  <p className='mt-2'>{current?.riskCount} 条到料风险</p>
                </div>
                <div className='rounded-lg border p-4'>
                  <p className='text-muted-foreground'>待批准路径 · 供应商 B</p>
                  <p className='mt-3 text-xl font-semibold'>
                    D{candidate?.arrivalDay}
                  </p>
                  <p className='mt-2'>{candidate?.riskCount} 条到料风险</p>
                </div>
              </div>
              <div>
                <p className='mb-2 font-medium'>核对批准条件</p>
                <ul className='list-disc space-y-2 ps-5'>
                  <li>
                    方案质量核验：
                    {snapshot?.state.planReviews
                      .filter(
                        (r) =>
                          r.planVersionId ===
                          snapshot.state.matter.planSelection?.planVersionId
                      )
                      .slice(-1)[0]?.result === 'approved'
                      ? '已通过'
                      : '尚未通过'}
                  </li>
                  {snapshot?.state.orders.map((order) => (
                    <li key={order.id}>
                      {order.id}：D{candidate?.arrivalDay}{' '}
                      {candidate && candidate.arrivalDay <= order.requiredDay
                        ? '满足'
                        : '不满足'}{' '}
                      D{order.requiredDay} 到料要求
                    </li>
                  ))}
                  <li>
                    DEC-02 的质量与时间条件已核对；本次确认完成负责人批准。
                  </li>
                </ul>
              </div>
              <p className='rounded-md bg-muted/40 p-4 leading-7'>
                批准后 DEC-03 替代 DEC-01。采购经办跟进 B
                的供应安排，销售经办同步相关订单的交期信息。两条任务先处于待发送状态，需另行确认发送。
              </p>
            </>
          )}
          {kind === 'close_matter' && (
            <>
              {snapshot?.state.scenario && (
                <ExecutionCards
                  snapshot={snapshot}
                  sources={sources}
                  openSource={openSource}
                />
              )}
              {snapshot && !snapshot.state.scenario && (
                <ReviewSummary
                  snapshot={snapshot}
                  sources={sources}
                  openSource={openSource}
                />
              )}
              <p className='rounded-md bg-muted/40 p-4 leading-7'>
                请核对以上决定、所有必要部门回执及遗留风险。确认关闭表示完成办公协同复核，实际业务结果以对应凭证为准。
              </p>
              <Sources
                sources={sources.filter((source) =>
                  [
                    'QA-B-001',
                    'DOC-RECEIPT-T-PUR',
                    'DOC-RECEIPT-T-SALES',
                    'DOC-DECISION-03',
                  ].some(
                    (id) =>
                      source.id === id ||
                      source.id === id + '-' + snapshot?.state.matter.id
                  )
                )}
                open={openSource}
              />
            </>
          )}
          {!['request_quality', 'approve_switch', 'close_matter'].includes(
            kind
          ) && (
            <div>
              <p className='mb-2 font-medium'>本次操作内容</p>
              <ul className='list-disc space-y-2 ps-5 leading-7'>
                {preview?.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            </div>
          )}
          <Badge variant={preview?.allowed ? 'outline' : 'destructive'}>
            {preview?.allowed ? '等待人工确认' : '条件尚未满足'}
          </Badge>
          {preview?.reason && (
            <p className='rounded-md bg-muted p-3 leading-6'>
              {preview.reason}
            </p>
          )}
          <ErrorNotice message={error} />
          {stale && (
            <p className='text-destructive'>事项已更新，请重新核对后确认。</p>
          )}
          {kind === 'approve_switch' && (
            <Button
              variant='link'
              className='px-0'
              disabled={busy}
              onClick={() => {
                close()
                viewMatter()
              }}
            >
              查看完整事项
            </Button>
          )}
        </div>
        <SheetFooter className='flex-row flex-wrap justify-end border-t'>
          <Button variant='outline' disabled={busy} onClick={close}>
            取消
          </Button>
          {(stale || !!error || !preview?.allowed) && (
            <Button variant='outline' disabled={busy} onClick={recheck}>
              重新检查
            </Button>
          )}
          <Button
            disabled={busy || !preview?.allowed || stale}
            onClick={confirm}
          >
            {busy && <Loader2 className='size-4 animate-spin' />}
            {confirmLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
