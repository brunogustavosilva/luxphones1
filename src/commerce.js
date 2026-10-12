export const productTypes = [
  { id: 'smartphones', label: 'Smartphones' },
  { id: 'chargers', label: 'Carregadores' },
  { id: 'headphones', label: 'Fones de ouvido' },
  { id: 'cases', label: 'Capinhas' },
  { id: 'computers', label: 'Computadores' },
  { id: 'notebooks', label: 'Notebooks' },
];
export const paymentLabels = { pending: 'Aguardando pagamento', approved: 'Pagamento aprovado', authorized: 'Autorizado', in_process: 'Em análise', in_mediation: 'Em mediação', rejected: 'Recusado', cancelled: 'Cancelado', partially_refunded: 'Reembolso parcial', refunded: 'Reembolsado', charged_back: 'Contestação' };
export const currency = (value = 0) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
export async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}
export function readStored(key, fallback, storage = localStorage) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function writeStored(key, value, storage = localStorage) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can disable storage. */ }
}
