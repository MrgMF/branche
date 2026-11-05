const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => MAP[c] ?? c);
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 5000 → « 50,00 € » (espace insécable). */
export function formatEuros(cents: number): string {
  return eur.format(cents / 100).replace(/ /g, ' ');
}
