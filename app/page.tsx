export default function Home() {
  // Middleware จะจัดการ redirect ให้เอง
  // เราแค่ render ค่าว่างๆ หรือ Loading รอไว้
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
    </div>
  )
}