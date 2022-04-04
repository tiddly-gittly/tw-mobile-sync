export function getDiffFilter(lastSync: string | undefined) {
  return `[all[]!is[system]] :filter[get[modified]compare:date:gt[${lastSync ?? ''}]]`;
}
