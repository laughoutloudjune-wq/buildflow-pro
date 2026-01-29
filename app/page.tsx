import { redirect } from 'next/navigation'

export default function Home() {
  // ดีดผู้ใช้งานเข้าไปที่หน้า Dashboard ทันที
  redirect('/dashboard')
}