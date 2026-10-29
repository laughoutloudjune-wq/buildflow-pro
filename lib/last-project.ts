// The project a person last used on a form, kept in their own browser, so a
// foreman who works one project all week doesn't pick it on every bill.

const KEY = 'buildflow:last-project'

export function readLastProject(validIds: string[]): string {
  try {
    const id = window.localStorage.getItem(KEY) || ''
    return validIds.includes(id) ? id : ''
  } catch {
    return ''
  }
}

export function rememberLastProject(id: string) {
  if (!id) return
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    // Private windows can refuse storage; the form just won't remember.
  }
}
