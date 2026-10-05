/** Production stays on its existing database; staging is selected explicitly. */
export function firestoreDatabaseId(value?: string, deploymentEnvironment?: string) {
  const id = value?.trim() || '(default)';
  if (!['(default)', 'staging'].includes(id)) throw Error('Unsupported Firestore database');
  if (deploymentEnvironment === 'production' && id !== '(default)') throw Error('Production must use its default Firestore database');
  return id;
}
