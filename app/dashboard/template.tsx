/**
 * Unlike a layout, a template is re-created on every navigation, so the
 * content area fades in each time the page changes. The sidebar and top bar
 * live in the layout and stay put.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="anim-page">{children}</div>
}
