// One independent representative per business type. Child orders, tasks,
// decisions and sources remain part of their parent matter without filtering.
export const representativeMatterIds = Object.freeze(['SUP-001', 'SUP-007', 'SUP-008', 'SUP-009'])
export const isRepresentativeMatter = id => representativeMatterIds.includes(id)
export const isRetiredDemoMatter = id => /^SUP-00[2-6]$/.test(id) || id === 'SUP-010'
export const visibleMatterIds = workspace => representativeMatterIds.filter(id => workspace.matters[id])
