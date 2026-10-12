import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CreditCard, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { currency, paymentLabels, request, writeStored, readStored } from './commerce.js';

export function useDialog(ref, onClose) {
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const getFocusable = () => [...ref.current.querySelectorAll('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]')];
    getFocusable()[0]?.focus();
    function keydown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = getFocusable();
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [ref, onClose]);
}

export function Cart({ cart, products, onQuantity, onRemove, onClose }) {
  const panel = useRef(null);
  const attempt = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 240);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useDialog(panel, requestClose);
  const lines = cart.map((line) => ({ ...line, product: products.find((item) => String(item.id) === line.product_id) }));
  const invalid = lines.some(({ quantity, product }) => !product || product.stock < quantity || Number(product.price) <= 0);
  const total = lines.reduce((sum, { product, quantity }) => sum + Math.round(Number(product?.price || 0) * 100) * quantity, 0) / 100;
  async function checkout(event) {
    event.preventDefault();
    if (busy || invalid || !cart.length) return;
    setBusy(true); setError('');
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { ...form, items: cart };
    const fingerprint = JSON.stringify(payload);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await request('/checkout', { method: 'POST', body: JSON.stringify({ ...payload, checkout_key: attempt.current.key }) });
      writeStored('luxphone-checkout', { token: result.order_token, url: result.checkout_url }, sessionStorage);
      window.location.assign(result.checkout_url);
    } catch (reason) { setError(reason.message); setBusy(false); }
  }
  return <div className={closing ? 'cart-backdrop cart-closing' : 'cart-backdrop'} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) requestClose(); }}>
    <section className="cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title" ref={panel}>
      <header className="cart-heading"><div><p className="eyebrow">SUA SELEÇÃO</p><h2 id="cart-title">Carrinho de compras.</h2></div><button type="button" className="cart-icon" onClick={requestClose} aria-label="Fechar carrinho"><X size={22}/></button></header>
      {!lines.length ? <div className="cart-empty"><ShoppingBag size={36}/><h3>Seu próximo favorito está por aqui.</h3><p>Explore o catálogo e adicione produtos ao carrinho.</p><button className="button button-dark" onClick={requestClose}>Continuar comprando <ArrowRight size={16}/></button></div> : <>
        <div className="cart-lines">{lines.map(({ product_id, quantity, product }) => <article className="cart-line" key={product_id}>
          {product?.image_url && <img src={product.image_url} alt=""/>}
          <div className="cart-line-copy"><strong>{product?.name || 'Produto indisponível'}</strong><small>{product ? currency(product.price) : 'Remova este item para continuar'}</small>
            <div className="cart-quantity"><button type="button" onClick={() => onQuantity(product_id, quantity - 1)} disabled={busy} aria-label={`Diminuir quantidade de ${product?.name || 'produto'}`}><Minus size={14}/></button><span aria-live="polite">{quantity}</span><button type="button" onClick={() => onQuantity(product_id, quantity + 1)} disabled={busy || !product || quantity >= Math.min(20, product.stock)} aria-label={`Aumentar quantidade de ${product?.name || 'produto'}`}><Plus size={14}/></button></div>
            {product && quantity > product.stock && <small className="cart-warning">Só restam {product.stock} unidades. Ajuste a quantidade.</small>}
          </div><button className="cart-icon" type="button" onClick={() => onRemove(product_id)} disabled={busy} aria-label={`Remover ${product?.name || 'produto'}`}><Trash2 size={17}/></button>
        </article>)}</div>
        <div className="cart-total"><span>Total dos produtos</span><strong>{currency(total)}</strong></div>
        <form className="checkout-form" onSubmit={checkout}><p className="eyebrow">DADOS DO CLIENTE</p><label>Nome completo<input name="customer_name" autoComplete="name" required minLength={2} maxLength={120} placeholder="Como podemos chamar você?"/></label><label>WhatsApp com DDD<input name="customer_whatsapp" type="tel" autoComplete="tel" required minLength={10} maxLength={20} placeholder="(41) 99999-9999"/></label><label>E-mail<input name="customer_email" type="email" autoComplete="email" required maxLength={160} placeholder="voce@email.com"/></label>
          <p className="eyebrow">ENDEREÇO</p><label>CEP<input name="customer_zipcode" autoComplete="postal-code" inputMode="numeric" required pattern="[0-9]{5}-?[0-9]{3}" maxLength={9} placeholder="00000-000"/></label><label>Endereço completo<input name="customer_address" autoComplete="street-address" required minLength={5} maxLength={300} placeholder="Rua, número, bairro, cidade e estado"/></label><label>Complemento <small>(opcional)</small><input name="customer_complement" autoComplete="address-line2" maxLength={160} placeholder="Apartamento, bloco ou ponto de referência"/></label>
          <p className="checkout-note">Entrega ou retirada combinada com a loja pelo WhatsApp. O total inclui os produtos; frete, se necessário, é combinado separadamente.</p>
          {invalid && <p className="cart-warning" role="alert">Revise os itens indisponíveis e as quantidades antes de continuar.</p>}
          {error && <p className="cart-warning" role="alert">{error}</p>}
          <button className="button button-dark checkout-button" disabled={busy || invalid}><CreditCard size={17}/>{busy ? 'Preparando pagamento…' : 'Pagar com PagBank'}<ArrowRight size={16}/></button>
          <p className="checkout-security">Pagamento processado com segurança pelo PagBank.</p>
        </form>
      </>}
    </section>
  </div>;
}

export function PaymentReturn({ token, onApproved, onDismiss }) {
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function sync() {
    setBusy(true); setError('');
    try {
      const result = await request(`/checkout/${encodeURIComponent(token)}/sync`, { method: 'POST' });
      setOrder(result);
      if (['approved', 'partially_refunded'].includes(result.payment_status)) onApproved();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { sync(); }, [token]);
  const saved = readStored('luxphone-checkout', null, sessionStorage);
  return <section className="payment-return wrap" role="status">
    <div><p className="eyebrow">SEU PEDIDO {order ? `#${order.id}` : ''}</p><h2>{order ? paymentLabels[order.payment_status] || 'Aguardando confirmação' : 'Consultando seu pagamento…'}</h2><p>{order?.payment_status === 'approved' ? 'Recebemos seu pagamento. Nossa equipe combinará os próximos passos pelo WhatsApp.' : `A confirmação é consultada diretamente no ${order?.provider === 'mercado_pago' ? 'Mercado Pago' : 'PagBank'}. Se você acabou de pagar, aguarde alguns instantes e atualize.`}</p>{order?.test_mode && <small>Compra no ambiente de teste.{order.provider_reference && <span className="test-order-id">Referência: {order.provider_reference}</span>}</small>}{order?.stock_issue && <p>A equipe entrará em contato para confirmar a disponibilidade dos itens.</p>}{error && <p className="cart-warning">{error}</p>}</div>
    <div className="payment-return-actions"><button className="button button-outline" disabled={busy} onClick={sync}>{busy ? 'Consultando…' : 'Atualizar pagamento'}</button>{order && ['pending', 'rejected', 'cancelled'].includes(order.payment_status) && saved?.token === token && <a className="button button-dark" href={saved.url}>Continuar pagamento</a>}<button className="cart-icon" onClick={onDismiss} aria-label="Fechar informação do pedido"><X size={20}/></button></div>
  </section>;
}
