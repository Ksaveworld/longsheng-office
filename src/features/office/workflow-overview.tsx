import { Badge } from '@/components/ui/badge'
import { Section, Sources, Status } from './shared'
import {
  roleNames,
  type Role,
  type Snapshot,
  type Source,
  type Task,
} from './types'

function textField(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : ''
}

function receiptEvidence(task: Task | undefined): string {
  return (
    typeof task?.receipt === 'string'
      ? task.receipt
      : textField(task?.receipt, 'evidence')
  ).trim()
}

function actorName(value: string | undefined): string {
  return value ? roleNames[value as Role] || value : '未记录'
}

function recordedTime(value: string | undefined): string {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function workflowState({ state, analysis }: Snapshot) {
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const selected = state.matter.planSelection?.supplierId
  const legacyB = !selected && (!!qa || state.matter.supplierId === 'B')
  const planned = selected || (legacyB ? 'B' : undefined)
  const receipts = ['T-PUR', 'T-SALES'].map((id) =>
    state.tasks.find((task) => task.id === id)
  )
  const receiptCount = receipts.filter((task) => receiptEvidence(task)).length
  const planReview = state.planReviews
    .filter(
      (r) => r.planVersionId === state.matter.planSelection?.planVersionId
    )
    .slice(-1)[0]
  const qualityLabel =
    state.matter.status === 'closed' && !state.planReviews.length
      ? '历史流程已归档'
      : !planned
        ? '待选择方案'
        : planReview?.result === 'approved'
          ? '核验通过'
          : planReview?.result === 'rejected'
            ? '核验不通过'
            : qa
              ? '待核验完成'
              : '待发起核验'
  return {
    qa,
    planned,
    legacyB,
    receipts,
    receiptCount,
    qualityLabel,
    approved: analysis.executionApproved,
  }
}

export function ReviewSummary({
  snapshot,
  sources,
  openSource,
}: {
  snapshot: Snapshot
  sources: Source[]
  openSource: (source: Source) => void
}) {
  const { state, analysis } = snapshot
  const { matter } = state
  const flow = workflowState(snapshot)
  const closed = matter.status === 'closed'
  const selection = matter.planSelection
  const approval = matter.followupApproval
  const review = matter.review
  const decision = state.decisions.find(
    (item) => item.id === analysis.effectiveDecisionId
  )
  const switchDecision = state.decisions.find(
    (item) => item.id === 'DEC-03' && item.status === 'effective'
  )
  const approvalActor =
    flow.planned === 'A'
      ? approval?.approvedBy
      : textField(switchDecision, 'approvedBy')
  const approvalAt =
    flow.planned === 'A'
      ? approval?.approvedAt
      : textField(switchDecision, 'createdAt')
  const missing = flow.receipts.flatMap((task, index) =>
    receiptEvidence(task) ? [] : [index === 0 ? '采购回执' : '销售回执']
  )
  const relatedIds = new Set([
    'DOC-NOTICE',
    'DOC-LEDGER',
    'DOC-MEETING-01',
    'DOC-MEETING-02',
    'QA-B-001',
    'DOC-RECEIPT-T-PUR',
    'DOC-RECEIPT-T-SALES',
    decision?.sourceId,
    approval?.sourceId,
  ])
  const relatedSources = sources.filter(
    (source) =>
      [...relatedIds].some(
        (id) => id && (source.id === id || source.id === id + '-' + matter.id)
      ) || /PLAN|FOLLOWUP|REVIEW/.test(source.id)
  )
  return (
    <Section
      title={closed ? '处理结果与最终复核' : '回执与最终复核'}
      aside={<Status value={matter.status} />}
    >
      <div className='space-y-5 text-sm'>
        <div className='grid gap-5 md:grid-cols-2'>
          <div className='space-y-2'>
            <p className='font-medium'>方案选择</p>
            <p>
              {flow.planned
                ? `供应商 ${flow.planned}${flow.legacyB ? ' · 已有 B 路径' : ''}`
                : '尚未选择本次处理方案'}
            </p>
            <p className='leading-6 text-muted-foreground'>
              {selection?.reason ||
                (flow.legacyB
                  ? '已有核验或切换记录，未记录单独的方案选择理由。'
                  : '选择理由尚未记录。')}
            </p>
            <p className='text-xs text-muted-foreground'>
              选择人：{actorName(selection?.selectedBy)} ·{' '}
              {recordedTime(selection?.selectedAt)}
            </p>
          </div>
          <div className='space-y-2'>
            <p className='font-medium'>当前有效决定</p>
            <p>
              {analysis.effectiveDecisionId} · 当前由供应商 {matter.supplierId}{' '}
              供货
            </p>
            <p className='leading-6 text-muted-foreground'>
              {decision?.text || '未找到对应决定原文。'}
            </p>
          </div>
          <div className='space-y-2'>
            <p className='font-medium'>负责人确认</p>
            <Badge variant='outline'>
              {flow.approved ? '已确认部门执行' : '尚待负责人确认'}
            </Badge>
            {flow.approved && (
              <p className='text-xs text-muted-foreground'>
                确认人：{actorName(approvalActor)} · {recordedTime(approvalAt)}
              </p>
            )}
            {flow.planned === 'A' && approval?.reason && (
              <p className='leading-6 text-muted-foreground'>
                {approval.reason}
              </p>
            )}
          </div>
          <div className='space-y-2'>
            <p className='font-medium'>当前方案版本质量核验</p>
            <Badge
              variant={
                flow.qualityLabel === '核验不通过' ? 'destructive' : 'outline'
              }
            >
              {flow.qualityLabel}
            </Badge>
            {flow.qa && (
              <>
                <p className='break-words whitespace-pre-wrap text-muted-foreground'>
                  {receiptEvidence(flow.qa) || '核验凭据尚未提交。'}
                </p>
                {!!receiptEvidence(flow.qa) && (
                  <p className='text-xs text-muted-foreground'>
                    提交人：{actorName(textField(flow.qa.receipt, 'actor'))} ·{' '}
                    {recordedTime(textField(flow.qa.receipt, 'at'))}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className='space-y-3 border-t pt-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='font-medium'>部门回执</p>
            <Badge variant='outline'>{flow.receiptCount}/2 已提交</Badge>
          </div>
          <div className='grid gap-3 md:grid-cols-2'>
            {flow.receipts.map((task, index) => (
              <div
                key={index === 0 ? 'T-PUR' : 'T-SALES'}
                className='min-w-0 space-y-3 rounded-md border p-4'
              >
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <p className='font-medium'>
                    {index === 0 ? '采购回执' : '销售回执'}
                  </p>
                  <Badge variant='secondary'>
                    {receiptEvidence(task)
                      ? closed
                        ? '已复核'
                        : '待最终复核'
                      : '待提交'}
                  </Badge>
                </div>
                <p className='break-words whitespace-pre-wrap text-muted-foreground'>
                  {receiptEvidence(task) || '尚未收到处理说明与凭据。'}
                </p>
                {!!receiptEvidence(task) && (
                  <p className='text-xs leading-5 text-muted-foreground'>
                    提交人：{actorName(textField(task?.receipt, 'actor'))}
                    <br />
                    提交时间：{recordedTime(textField(task?.receipt, 'at'))}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className='leading-6 text-muted-foreground'>
            {missing.length
              ? `仍缺：${missing.join('、')}。`
              : '采购与销售回执已齐全。'}
            {!flow.approved && ' 负责人尚未确认部门执行。'}
            {!closed &&
              !analysis.canClose &&
              !missing.length &&
              ' 其他关闭条件尚未满足，请核对当前办理步骤。'}
          </p>
        </div>
        <div className='space-y-2 rounded-md bg-muted/30 p-4'>
          <p className='font-medium'>
            {closed ? '最终复核记录' : '最终人工复核'}
          </p>
          {closed ? (
            <>
              <p>
                复核人：{actorName(review?.reviewedBy)} · 复核时间：
                {recordedTime(review?.reviewedAt)}
              </p>
              {!review && (
                <p className='text-muted-foreground'>
                  历史记录未保存独立复核摘要；关闭时间：
                  {recordedTime(matter.closedAt)}。
                </p>
              )}
              {review && (
                <p className='leading-6 text-muted-foreground'>
                  复核决定 {review.decisionId} · 供应商 {review.supplierId} ·
                  已核对回执 {review.receiptTaskIds.join('、')}。
                </p>
              )}
            </>
          ) : (
            <p className='leading-6 text-muted-foreground'>
              {analysis.canClose
                ? '回执已齐全，请业务负责人核对上述内容后确认关闭。'
                : '完成必要确认与部门回执后，由业务负责人进行最终复核。'}
            </p>
          )}
          <p
            className={
              analysis.riskCount
                ? 'leading-6 text-destructive'
                : 'leading-6 text-muted-foreground'
            }
          >
            当前方案仍有 {analysis.riskCount} 条到料风险
            {review ? `；复核时记录 ${review.riskCount} 条` : ''}
            。关闭办公事项不代表实物到货或订单已交付。
          </p>
        </div>
        {relatedSources.length > 0 && (
          <div className='space-y-3 border-t pt-4'>
            <p className='font-medium'>相关原始资料与处理凭据</p>
            <Sources sources={relatedSources} open={openSource} />
          </div>
        )}
      </div>
    </Section>
  )
}
