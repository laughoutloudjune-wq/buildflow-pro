'use client'

import { MouseEvent } from 'react'

export function CloseButton() {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    window.close()
  }

  return (
    <a href="#" onClick={handleClick} className="text-sm text-slate-500 hover:text-red-500">
      ปิดหน้าต่าง
    </a>
  )
}
