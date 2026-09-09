import { createFileRoute } from '@tanstack/react-router'
import { OfficeApp } from '@/features/office'

export const Route = createFileRoute('/_authenticated/office')({ component: OfficeApp })
