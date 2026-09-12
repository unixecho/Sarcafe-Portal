/** Shared by MenuEditor and MenuOnboardingWizard so a category/item minted
 * in either place gets an id in the same shape (`c<...>`/`i<...>`). */
export function randomId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}
