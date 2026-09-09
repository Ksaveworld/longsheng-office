// Original SVGs reused byte-for-byte from platform-demo/web/src/assets/brand/.
export function AhsBrand() {
  return <a href={`${import.meta.env.BASE_URL}office#home`} aria-label='爱化身 · 龙盛办公协同首页' className='flex min-h-14 items-center gap-3 overflow-hidden rounded-lg px-2 py-2 focus-visible:outline-2'>
    <img src={`${import.meta.env.BASE_URL}brand/logo-mark-aihuashen.svg`} alt='爱化身标识' width={32} height={32} className='size-8 shrink-0 dark:invert' />
    <span className='min-w-0 group-data-[collapsible=icon]:hidden'>
      <img src={`${import.meta.env.BASE_URL}brand/logo-wordmark-aihuashen.svg`} alt='AiHuaShen' width={142} height={19} className='h-auto w-[142px] dark:invert' />
      <span className='mt-1.5 block text-xs text-muted-foreground'>龙盛办公协同</span>
    </span>
  </a>
}
