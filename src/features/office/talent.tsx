import { useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const fusionSource =
  'https://xqmqf98k8t.feishu.cn/wiki/Z5NhwrziqijWLLkcZtZcIoiwnLh'

const cases = [
  {
    id: 'hangzhou',
    title: '杭州 · TypeScript 人才',
    subtitle: '信息一致性',
    question:
      '期望城市是杭州，累计工作年限大于 5 年，期望年薪小于 30 万，本人技术栈包含 TypeScript，简历信息准确无矛盾的候选人有哪些？',
    conditions: [
      [
        '期望城市 = 杭州',
        '求职偏好',
        '核对期望工作地点；现居地不能替代期望城市。',
      ],
      [
        '累计工作年限 > 5 年',
        '任职经历',
        '按有效任职区间计算，重叠时间按约定规则处理；不直接采用简历自述年限。',
      ],
      [
        '期望年薪 < 30 万',
        '薪酬期望',
        '先统一年薪和金额单位；严格小于，不包含 30 万。',
      ],
      [
        '本人技能含 TypeScript',
        '本人技能',
        '核对归属于候选人的技能证据；项目技术栈不能直接当作本人技能。',
      ],
      [
        '信息一致性核验',
        '出生日期与经历',
        '定位年龄、教育和任职时间的差异；异常是核验线索，不直接等于简历造假。',
      ],
    ],
    result: '韦宇',
    count: 1,
    excluded: '乔芸梅',
    reason:
      '材料记录存在年龄冲突、入学年龄异常。需要回到出生日期、年龄表述与教育经历核对。',
    baseline: '返回韦宇、乔芸梅',
    baselineTime: '11 分钟',
    time: '31 秒',
    anchor: 'doxcnN42H2sd3HEwkCJO3EFuxPh',
  },
  {
    id: 'beijing',
    title: '北京 · Go 人才',
    subtitle: '条件归属',
    question:
      '期望城市在北京，最近在腾讯本部（不含腾讯控股）工作，第一学历是本科，本人技术栈包含 Go，简历信息准确无矛盾的候选人有哪些？',
    conditions: [
      [
        '期望城市 = 北京',
        '求职偏好',
        '只核对期望城市，不把现居地或历史工作地作为匹配依据。',
      ],
      [
        '最近雇主为腾讯本部',
        '任职与雇主主体',
        '结合任职日期确认最近雇主，并按题目约定排除腾讯控股范围。',
      ],
      [
        '第一学历 = 本科',
        '教育先后关系',
        '按教育经历顺序核对第一学历，不能用最高学历替代。',
      ],
      [
        '本人技能含 Go',
        '本人技能',
        '项目使用 Go 不等于本人掌握 Go，需要个人职责或技能记录。',
      ],
      [
        '信息一致性核验',
        '任职、教育与项目',
        '检查工作年限、教育任职重叠和项目参与时间；无法解释的差异留待人工核验。',
      ],
    ],
    result: '滕霞远',
    count: 1,
    excluded: '云娟',
    reason:
      '材料列出工作年限夸大、学历与工作经历重叠、项目早于入职、空窗期异常。逐条核对后再作判断。',
    baseline: '返回滕霞远、云娟',
    baselineTime: '15 分钟',
    time: '34 秒',
    anchor: 'doxcnaVCEvF7OBDEZNhXpBfRUkf',
  },
  {
    id: 'shanghai',
    title: '上海 · 博士 FDE',
    subtitle: '多条件交集',
    question:
      '找最高学历为博士、年龄大于或等于 30 岁、期望城市为上海的 FDE 候选人，简历信息准确无矛盾的候选人有哪些？',
    conditions: [
      [
        '最高学历 = 博士',
        '教育经历',
        '核对最高学历对应的记录，不能把在读或未确认的经历自动视为已取得学历。',
      ],
      [
        '年龄 ≥ 30 岁',
        '出生日期',
        '按统一统计基准日计算周岁；缺出生日期时不能直接认定满足条件。',
      ],
      [
        '期望城市 = 上海',
        '求职偏好',
        '明确匹配期望城市，而非学校、项目或当前公司的所在地。',
      ],
      [
        'FDE 候选人',
        '岗位与经历',
        '按约定的岗位口径核对；只有关键词不足以说明满足岗位要求。',
      ],
      [
        '所有条件同时成立',
        '同一候选人',
        '全部条件必须属于同一人。无符合结果时保留空结果，不自动放宽条件。',
      ],
    ],
    result: '当前案例无符合者',
    count: 0,
    excluded: '',
    reason:
      '材料记录的预期答案为 0 人。正文未提供逐人、逐条件的完整排除明细；本页不补造名单或原因。',
    baseline: '返回 4 人',
    baselineTime: '22 分钟',
    time: '25 秒',
    anchor: 'doxcna19rzX5j4uQKYAeS6jPuxf',
  },
] as const

export function Talent() {
  const [caseId, setCaseId] = useState(() => {
    const saved = sessionStorage.getItem('office-talent-case')
    return cases.some((item) => item.id === saved) ? saved! : cases[0].id
  })
  const [condition, setCondition] = useState(0)
  const current = cases.find((item) => item.id === caseId) || cases[0]
  const selected = current.conditions[condition]
  return (
    <div className='space-y-6' data-testid='talent-workspace'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-3 text-sm'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline'>材料案例回放</Badge>
          <span className='text-muted-foreground'>
            合成简历测试记录 · 未连接实时人力库
          </span>
        </div>
        <a
          className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
          href={fusionSource}
          target='_blank'
          rel='noreferrer'
        >
          查看飞书原始材料 <ExternalLink className='size-3.5' />
        </a>
      </div>
      <div className='grid gap-5 xl:grid-cols-[250px_minmax(0,1fr)]'>
        <aside className='min-w-0'>
          <h2 className='mb-3 text-sm font-medium text-muted-foreground'>
            选择一个业务问题
          </h2>
          <div className='grid gap-2 sm:grid-cols-3 xl:grid-cols-1'>
            {cases.map((item) => (
              <button
                key={item.id}
                aria-pressed={current.id === item.id}
                onClick={() => {
                  setCaseId(item.id)
                  setCondition(0)
                  sessionStorage.setItem('office-talent-case', item.id)
                }}
                className={`rounded-xl border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${current.id === item.id ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted'}`}
              >
                <span className='mb-2 block text-xs text-muted-foreground'>
                  {item.subtitle}
                </span>
                <span className='block font-semibold'>{item.title}</span>
              </button>
            ))}
          </div>
          <p className='mt-4 text-xs leading-6 text-muted-foreground'>
            同一种核对方式，也用于龙盛的订单、质量和会议决定：条件要对应到正确对象，结论要能追溯到来源。
          </p>
          <a
            href='#knowledge'
            className='mt-2 inline-flex items-center gap-1 text-sm text-primary'
          >
            查看龙盛业务依据 <ArrowRight className='size-4' />
          </a>
        </aside>
        <div className='min-w-0 space-y-5'>
          <section className='rounded-xl border bg-card p-5 sm:p-6'>
            <div className='mb-3 flex items-center gap-2 text-sm text-muted-foreground'>
              <Users className='size-4' />
              人才筛选问题
            </div>
            <h2 className='max-w-4xl text-xl leading-9 font-semibold'>
              {current.question}
            </h2>
            <div className='mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
              {[
                '拆解条件',
                '关联同一候选人',
                '核对事实与规则',
                '返回结果与依据',
              ].map((item, index) => (
                <span key={item} className='inline-flex items-center gap-2'>
                  <span className='rounded-md bg-muted px-3 py-2'>{item}</span>
                  {index < 3 && <ArrowRight className='size-3' />}
                </span>
              ))}
            </div>
          </section>
          <section className='rounded-xl border bg-card p-5 sm:p-6'>
            <h3 className='font-semibold'>每个条件，具体在核对什么</h3>
            <p className='mt-1 text-sm text-muted-foreground'>
              点击条件，查看它对应的事实和判断口径。
            </p>
            <div className='mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
              <div className='space-y-2'>
                {current.conditions.map(([label, object], index) => (
                  <button
                    key={label}
                    aria-pressed={condition === index}
                    onClick={() => setCondition(index)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${condition === index ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
                  >
                    <span>{label}</span>
                    <span className='text-xs text-muted-foreground'>
                      {object}
                    </span>
                  </button>
                ))}
              </div>
              <div className='rounded-lg bg-muted/60 p-5' aria-live='polite'>
                <div className='flex items-center gap-2 text-sm text-primary'>
                  <FileSearch className='size-4' />
                  条件解释
                </div>
                <h4 className='mt-4 text-lg font-semibold'>{selected[0]}</h4>
                <p className='mt-2 text-xs text-muted-foreground'>
                  事实归属：候选人 → {selected[1]}
                </p>
                <p className='mt-5 text-sm leading-7'>{selected[2]}</p>
                <p className='mt-4 border-t pt-4 text-xs leading-6 text-muted-foreground'>
                  这里展示核对方法。逐项原始简历、统计日期和完整规则版本需从原材料进一步核验。
                </p>
              </div>
            </div>
          </section>
          <section
            className='rounded-xl border bg-card p-5 sm:p-6'
            aria-live='polite'
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h3 className='font-semibold'>材料记录的筛选结果</h3>
              <Badge variant='secondary'>
                {current.count} 人符合测试集设定
              </Badge>
            </div>
            <div className='mt-5 flex items-start gap-3'>
              <CheckCircle2 className='mt-1 size-5 shrink-0 text-primary' />
              <div>
                <p className='text-xl font-semibold'>{current.result}</p>
                <p className='mt-2 text-sm leading-6 text-muted-foreground'>
                  {current.count
                    ? '材料记录其满足该题条件；本页未重新执行检索或验证个人履历。'
                    : '保留空结果，避免把部分满足条件的人作为完整匹配。'}
                </p>
              </div>
            </div>
            <div className='mt-5 rounded-lg border border-dashed p-4'>
              <h4 className='text-sm font-medium'>
                {current.excluded
                  ? `需要回查的差异：${current.excluded}`
                  : '排除明细的证据边界'}
              </h4>
              <p className='mt-2 text-sm leading-7 text-muted-foreground'>
                {current.reason}
              </p>
            </div>
            <div className='mt-4 flex flex-wrap gap-3'>
              <Button variant='outline' asChild>
                <a
                  href={`${fusionSource}#${current.anchor}`}
                  target='_blank'
                  rel='noreferrer'
                >
                  打开本题原始证据 <ExternalLink className='size-4' />
                </a>
              </Button>
              <Button variant='ghost' asChild>
                <a href='#assistant'>
                  进入龙盛业务助手 <ArrowRight className='size-4' />
                </a>
              </Button>
            </div>
          </section>
          <details className='rounded-xl border p-5'>
            <summary className='cursor-pointer text-sm font-medium'>
              查看材料中的同题对比记录
            </summary>
            <div className='mt-4 grid gap-3 sm:grid-cols-2'>
              <div className='rounded-lg bg-muted p-4'>
                <p className='text-sm font-medium'>飞书侧案例记录</p>
                <p className='mt-2 text-sm'>{current.baseline}</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  记录耗时：{current.baselineTime}
                </p>
              </div>
              <div className='rounded-lg bg-muted p-4'>
                <p className='text-sm font-medium'>DataOS 侧案例记录</p>
                <p className='mt-2 text-sm'>{current.result}</p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  记录耗时：{current.time}
                </p>
              </div>
            </div>
            <p className='mt-3 text-xs leading-6 text-muted-foreground'>
              来源为飞书文档 revision 346，本页于 2026-09-15
              读取。以上为文档保存的单次案例，不是本页运行耗时，也不代表整体准确率或响应承诺；本次未复跑对比测试。
            </p>
          </details>
        </div>
      </div>
    </div>
  )
}
