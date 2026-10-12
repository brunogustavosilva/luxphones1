import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Box, Check, ChevronDown, CircleHelp,
  CreditCard, LayoutDashboard, LogOut, Menu, Package, Plus, Search,
  Settings2, ShieldCheck, Smartphone, Sparkles, Truck, Wrench, X, ShoppingBag, Moon, Sun, RefreshCw,
} from 'lucide-react';

import { Cart, PaymentReturn, useDialog } from './Cart.jsx';
import { productTypes, paymentLabels, currency, readStored, writeStored } from './commerce.js';

const sampleProducts = [
  { id: 'a1', name: 'iPhone 16 Pro', description: 'Tela Super Retina XDR de 6,3 polegadas, chip A18 Pro e sistema de câmeras avançado. Produto novo, lacrado e com garantia Apple.', category: 'Apple', sku: 'APL-16P', price: 7899, stock: 8, image_url: 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=900&q=85' },
  { id: 'a2', name: 'Galaxy S25 Ultra', description: 'Smartphone premium com tela ampla, S Pen integrada e recursos Galaxy AI. Produto novo, lacrado e com garantia de fábrica.', category: 'Samsung', sku: 'SAM-S25U', price: 7299, stock: 5, image_url: 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=900&q=85' },
  { id: 'a3', name: 'iPhone 15', description: 'Tela Super Retina XDR de 6,1 polegadas, câmera principal de 48 MP e conexão USB-C. Aparelho revisado e pronto para uso.', category: 'Apple', sku: 'APL-15', price: 4599, stock: 12, image_url: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&w=900&q=85' },
  { id: 'a4', name: 'Pixel 9 Pro', description: 'Câmeras Pixel com processamento inteligente, tela LTPO OLED e recursos de IA do Google. Aparelho desbloqueado e revisado.', category: 'Google', sku: 'GOO-P9P', price: 6199, stock: 4, image_url: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=85' },
];
const money = currency;
const todayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toLocaleUpperCase('pt-BR');
const whatsappUrl = 'https://web.whatsapp.com/';

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}

function Brand() {
  return <a className="brand" href="/" aria-label="Lux Baterias início">
    <svg className="brand-symbol" viewBox="0 0 124 100" role="img" aria-label="Monograma Lux Baterias">
      <path className="brand-symbol-silver" d="M4 3 20 14v68l37-36 13 13-49 48H4z" />
      <path className="brand-symbol-silver" d="m63 48 38-38h20L76 61z" />
      <path className="brand-symbol-gold" d="M27 34h19l71 73H98z" />
    </svg>
    <span className="brand-word">LUX BATERIAS</span>
  </a>;
}

function ProductDetails({ product, onClose }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);
  useDialog(panel, close);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal product-details-modal" role="dialog" aria-modal="true" aria-labelledby="product-details-title" ref={panel}>
      <div className="modal-heading"><div><p className="eyebrow">DETALHES DO PRODUTO</p><h2 id="product-details-title">{product.name}</h2></div><button type="button" onClick={close} aria-label="Fechar detalhes"><X size={20}/></button></div>
      {product.image_url && <img className="product-details-image" src={product.image_url} alt={product.name}/ >}
      <p className="product-details-price">{money(product.price)}</p>
      <div className="product-details-copy">{product.description || 'Detalhes não informados.'}</div>
    </section>
  </div>;
}

function useMobileMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const closeOnDesktop = () => { if (!media.matches) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    media.addEventListener('change', closeOnDesktop);
    window.addEventListener('keydown', closeOnEscape);
    return () => { media.removeEventListener('change', closeOnDesktop); window.removeEventListener('keydown', closeOnEscape); };
  }, []);
  return [open, setOpen];
}

function Storefront() {
  const [products, setProducts] = useState(sampleProducts);
  const [filter, setFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('Todos');
  const [displayFilters, setDisplayFilters] = useState({ category: 'all', brand: 'Todos', revision: 0 });
  const [catalogExiting, setCatalogExiting] = useState(false);
  useEffect(() => {
    if (filter === displayFilters.category && brandFilter === displayFilters.brand) {
      setCatalogExiting(false);
      return;
    }
    const commit = () => {
      setDisplayFilters((current) => ({ category: filter, brand: brandFilter, revision: current.revision + 1 }));
      setCatalogExiting(false);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { commit(); return; }
    setCatalogExiting(true);
    const timer = window.setTimeout(commit, 160);
    return () => window.clearTimeout(timer);
  }, [filter, brandFilter, displayFilters.category, displayFilters.brand]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showFloatingCart, setShowFloatingCart] = useState(false);
  const headerCartRef = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setShowFloatingCart(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    }, { threshold: 0 });
    if (headerCartRef.current) observer.observe(headerCartRef.current);
    return () => observer.disconnect();
  }, []);
  const [cart, setCart] = useState(() => {
    const stored = readStored('luxphone-cart', []);
    return Array.isArray(stored) ? stored.filter((item) => /^\d+$/.test(item?.product_id) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 20).slice(0, 30) : [];
  });
  const [returnToken, setReturnToken] = useState(() => new URLSearchParams(window.location.search).get('checkout_return'));
  const closeCart = useCallback(() => setCartOpen(false), []);
  const clearCart = useCallback(() => setCart([]), []);
  useEffect(() => { writeStored('luxphone-cart', cart); }, [cart]);
  useEffect(() => {
    if (returnToken) window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }, [returnToken]);
  function addToCart(product) {
    setCart((current) => {
      const existing = current.find((item) => item.product_id === String(product.id));
      if (existing) return current.map((item) => item === existing ? { ...item, quantity: Math.min(item.quantity + 1, product.stock, 20) } : item);
      return [...current, { product_id: String(product.id), quantity: 1 }];
    });
    setCartOpen(true);
  }
  function changeQuantity(id, quantity) {
    const product = products.find((item) => String(item.id) === id);
    setCart((current) => quantity < 1 ? current.filter((item) => item.product_id !== id) : current.map((item) => item.product_id === id ? { ...item, quantity: Math.min(quantity, Math.max(1, product?.stock || 1), 20) } : item));
  }
  const [menuOpen, setMenuOpen] = useMobileMenu();
  useEffect(() => { api('/products').then(setProducts).then(() => setCatalogReady(true)).catch(() => { setProducts([]); setCatalogError('Não foi possível carregar o catálogo. Atualize a página para tentar novamente.'); }); }, []);
  const categories = ['Todos', ...new Set(products.map((item) => item.category))];
  const visible = products.filter((item) => (displayFilters.category === 'all' || (item.product_type || 'smartphones') === displayFilters.category) && (displayFilters.brand === 'Todos' || item.category === displayFilters.brand));
  const featured = products.find((product) => String(product.category).toLowerCase() === 'apple') || sampleProducts[0];
  return <div className="store-page">
    <header className="store-header wrap">
      <Brand />
      <nav id="store-navigation" className={menuOpen ? 'store-nav nav-open' : 'store-nav'} aria-label="Navegação principal">
        <a href="#servicos" onClick={() => setMenuOpen(false)}>Serviços</a>
        <a href="#colecao" onClick={() => setMenuOpen(false)}>Produtos</a>
        <a href="#sobre" onClick={() => setMenuOpen(false)}>Sobre nós</a>
        <a href="#contato" onClick={() => setMenuOpen(false)}>Contato</a>
        <a href="/admin" className="mobile-admin-entry">Área do administrador</a>
      </nav>
      <div className="header-actions"><button ref={headerCartRef} className="cart-trigger" onClick={() => setCartOpen(true)} aria-label={`Abrir carrinho, ${cart.reduce((sum, item) => sum + item.quantity, 0)} itens`}><ShoppingBag size={19}/><span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span></button><a href="/admin" className="admin-entry"><ShieldCheck size={15}/> Área do administrador</a><button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Fechar navegação' : 'Abrir navegação'} aria-expanded={menuOpen} aria-controls="store-navigation">{menuOpen ? <X size={22}/> : <Menu size={22}/>}</button></div>
    </header>
    <main>
      {returnToken && <PaymentReturn token={returnToken} onApproved={clearCart} onDismiss={() => setReturnToken(null)}/>}
      <section className="hero wrap" id="manifesto">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line"/> SMARTPHONES · BATERIAS · ASSISTÊNCIA</p>
          <h1>Tecnologia que<br/>define o<br/><em>extraordinário.</em></h1>
          <p className="hero-lede">Smartphones, baterias e acessórios selecionados, com assistência especializada e procedência em cada detalhe.</p>
          <div className="hero-actions"><a href="#colecao" className="button button-dark">Explorar catálogo <ArrowRight size={16}/></a><a className="hero-contact" href="#contato">Falar com especialista</a></div>
          <div className="hero-proof"><span><ShieldCheck size={14}/> Garantia oficial</span><span><Sparkles size={14}/> Produtos selecionados</span><span><Truck size={14}/> Entrega para todo Brasil</span></div>
        </div>
        <div className="hero-visual">
          <div className="hero-product-art" aria-label="Ilustração de smartphone premium dourado">
            <span className="phone-orbit"/>
            <div className="phone phone-back"><span className="camera-lens lens-one"/><span className="camera-lens lens-two"/><span className="camera-lens lens-three"/><span className="camera-flash"/></div>
            <div className="phone phone-front"><span className="dynamic-island"/><span className="screen-number">17</span></div>
          </div>
          <div className="hero-feature"><span>NOVO · LACRADO</span><strong>{featured.name || 'iPhone 17 Pro Max'}</strong><small>A partir de {money(featured.price || 7599)}</small></div>
        </div>
      </section>
      <section className="catalog wrap" id="colecao">
        <div className="catalog-heading"><div><p className="eyebrow">CATÁLOGO OFICIAL</p><h2>Escolhas premium.<br/><em>Sem abrir mão da confiança.</em></h2></div><p>Smartphones, acessórios e soluções para o seu aparelho, selecionados e revisados pela equipe Lux Baterias.</p></div>
        <div className="filters category-filters" aria-label="Filtrar por categoria">{[{ id: 'all', label: 'Todos os produtos' }, ...productTypes].map((category) => <button key={category.id} className={filter === category.id ? 'filter active' : 'filter'} aria-pressed={filter === category.id} onClick={() => setFilter(category.id)}>{category.label}</button>)}</div>
        <div className="catalog-brand-filter"><label htmlFor="brand-filter">Marca</label><select id="brand-filter" value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>{categories.map((brand) => <option key={brand}>{brand}</option>)}</select><span>{visible.length} produtos</span></div>
        {catalogError && <p className="cart-warning" role="alert">{catalogError}</p>}
        {!catalogReady && !catalogError && <p className="catalog-empty">Carregando catálogo…</p>}
        {catalogReady && !visible.length && <p key={`empty-${displayFilters.revision}`} className={catalogExiting ? 'catalog-empty catalog-filter-empty catalog-exiting' : 'catalog-empty catalog-filter-empty'}>Nenhum produto nesta seleção. Novidades chegam em breve.</p>}
        <div key={`catalog-${displayFilters.revision}`} className={catalogExiting ? 'product-grid catalog-exiting' : 'product-grid catalog-reveal'} aria-busy={catalogExiting} inert={catalogExiting ? '' : undefined}>{catalogReady && visible.map((product, index) => <article className="product-card" key={product.id} style={{ '--reveal-delay': `${Math.min(index * 45, 225)}ms` }}><button type="button" className="product-visual" onClick={() => setSelectedProduct(product)} aria-label={`Ver detalhes de ${product.name}`}><img src={product.image_url || sampleProducts[index % sampleProducts.length].image_url} alt={product.name} loading="lazy"/><span className="product-index">{String(index + 1).padStart(2, '0')}</span><span className="product-open"><ArrowUpRight size={17}/></span><span className="product-tag">{product.stock > 0 ? 'DISPONÍVEL' : 'SEM ESTOQUE'}</span></button><div className="product-overline"><span>{product.category}</span><span>{productTypes.find((type) => type.id === (product.product_type || 'smartphones'))?.label}</span></div><div className="product-title"><button type="button" className="product-name-button" onClick={() => setSelectedProduct(product)}>{product.name}</button><span>{money(product.price)}</span></div><button className="product-add" onClick={() => addToCart(product)} disabled={product.stock <= 0 || Number(product.price) <= 0}>{product.stock > 0 && Number(product.price) > 0 ? 'Adicionar ao carrinho' : 'Indisponível'}<Plus size={15}/></button></article>)}</div>
        <div className="catalog-cta"><div><p className="eyebrow">CATÁLOGO COMPLETO</p><h3>Veja todos os modelos e condições.</h3><p>Estoque sujeito a alteração. Consulte a disponibilidade antes da compra.</p></div><a href="#contato" className="button button-outline">Abrir catálogo <ArrowUpRight size={15}/></a><a href={whatsappUrl} target="_blank" rel="noreferrer" className="button button-gold">Consultar estoque</a></div>
      </section>
      <section className="services-section" id="servicos"><div className="wrap services-inner"><div className="services-heading"><div><p className="eyebrow">O QUE FAZEMOS</p><h2>Soluções completas<br/>para o seu dia a dia.</h2></div><p>Do reparo mais delicado ao seu próximo aparelho, cuidamos de cada detalhe com agilidade, procedência e atendimento próximo.</p></div><div className="service-grid"><article className="service-card"><span>01</span><WrenchIcon/><h3>Assistência técnica</h3><p>Diagnóstico preciso, troca de tela, bateria, conectores e reparos avançados.</p><a href={whatsappUrl} target="_blank" rel="noreferrer">Saiba mais <ArrowRight size={14}/></a></article><article className="service-card"><span>02</span><Smartphone size={20}/><h3>Smartphones</h3><p>Aparelhos novos e seminovos selecionados, testados e com garantia.</p><a href={whatsappUrl} target="_blank" rel="noreferrer">Saiba mais <ArrowRight size={14}/></a></article><article className="service-card"><span>03</span><ShieldCheck size={20}/><h3>Acessórios</h3><p>Proteção e praticidade com capas, películas, cabos e carregadores premium.</p><a href={whatsappUrl} target="_blank" rel="noreferrer">Saiba mais <ArrowRight size={14}/></a></article></div></div></section>
      <section className="about-band" id="sobre"><div className="wrap about-inner"><div><p className="eyebrow">LUX BATERIAS CURITIBA</p><h2>Tecnologia sem<br/><em>complicação.</em></h2></div><div className="about-stats"><div><strong>4.9</strong><span>AVALIAÇÃO MÉDIA</span></div><div><strong>+2 mil</strong><span>APARELHOS REPARADOS</span></div><div><strong>90 dias</strong><span>GARANTIA DE SERVIÇO</span></div></div></div></section>
      <section className="contact-band" id="contato"><div className="wrap"><h2>Pronto para cuidar do seu celular?</h2><a href="mailto:oi@luxphones.com.br" className="button button-dark">Falar com especialista <ArrowRight size={15}/></a></div></section>
    </main>
    <button className={showFloatingCart && !cartOpen ? 'floating-cart floating-cart-visible' : 'floating-cart'} onClick={() => setCartOpen(true)} aria-label={`Abrir carrinho, ${cart.reduce((sum, item) => sum + item.quantity, 0)} itens`} aria-hidden={!showFloatingCart || cartOpen} tabIndex={showFloatingCart && !cartOpen ? 0 : -1}><ShoppingBag size={23}/><span className="floating-cart-count">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span></button>
    {cartOpen && <Cart cart={cart} products={catalogReady ? products : []} onQuantity={changeQuantity} onRemove={(id) => setCart((current) => current.filter((item) => item.product_id !== id))} onClose={closeCart}/>}
    <footer className="store-footer wrap"><Brand/><span>© 2026 LUX BATERIAS CURITIBA</span><a href="/admin">Área do cliente <ArrowRight size={14}/></a></footer>
    {selectedProduct && <ProductDetails product={selectedProduct} onClose={() => setSelectedProduct(null)}/>}
  </div>;
}

function WrenchIcon() {
  return <span className="service-wrench"><Settings2 size={20}/></span>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setError(''); setBusy(true); try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); onLogin(); } catch (reason) { setError(reason.message); } finally { setBusy(false); } }
  return <main className="login-page"><section className="login-story"><Brand/><div className="login-story-copy"><p className="eyebrow">GESTÃO INTELIGENTE</p><h1>Tudo sob<br/>controle.<br/><em>Do balcão à<br/>entrega.</em></h1><p>Reparos, vendas e financeiro organizados em um só lugar para você focar no que importa.</p></div><small>© 2026 Lux Baterias Curitiba · Sistema de gestão</small></section><section className="login-panel"><a href="/" className="back-store"><ArrowRight size={14}/> Voltar para o site</a><div className="login-lock"><ShieldCheck size={18}/></div><div className="login-intro"><p className="eyebrow">ACESSO RESTRITO</p><h2>Bem-vindo de volta</h2><p>Acesse sua conta para gerenciar a Lux Baterias.</p></div><form onSubmit={submit}><label htmlFor="username">Usuário</label><input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required/><label htmlFor="password">Senha</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-dark login-submit" disabled={busy}>{busy ? 'Entrando...' : 'Entrar no sistema'} <ArrowRight size={16}/></button></form><p className="login-security">Acesso exclusivo para equipe autorizada.</p></section></main>;
}

function Stat({ label, value, detail, icon: Icon, accent }) {
  return <article className="stat-card"><div className="stat-head"><span>{label}</span><span className="stat-icon"><Icon size={17}/></span></div><strong>{value}</strong><div className={accent ? 'stat-detail accent' : 'stat-detail'}>{detail}</div></article>;
}

function OrderTable({ orders, onStatus, onPayment, onSync, syncing, onDetails }) {
  if (!orders.length) return <div className="empty-state"><span><Package size={20}/></span><strong>Nenhum pedido por aqui ainda.</strong><p>Os pedidos registrados aparecerão nesta lista.</p></div>;
  const labels = { pending: 'Pendente', paid: 'Pago', shipped: 'Enviado', delivered: 'Entregue', cancelled: 'Cancelado' };
  return <div className="table-scroll"><table className="orders-table commerce-orders-table"><thead><tr><th>PEDIDO / DATA</th><th>CLIENTE / WHATSAPP</th><th>DETALHES</th><th>VALOR</th><th>PAGAMENTO</th><th>OPERAÇÃO</th></tr></thead><tbody>{orders.map((order) => {
    const online = ['mercado_pago', 'pagbank'].includes(order.source);
    const providerLabel = order.source === 'pagbank' ? 'PagBank' : 'Mercado Pago';
    const allowed = online ? ['pending', 'paid', 'shipped', 'delivered', 'cancelled'].filter((status) => status === order.status || (order.payment_status === 'approved' && ['shipped', 'delivered'].includes(status) && !order.stock_issue && !order.payment_issue)) : Object.keys(labels);
    return <tr key={order.id}><td><strong>#{String(order.id).slice(-6).toUpperCase()}</strong><small className="order-secondary">{new Date(order.created_at).toLocaleDateString('pt-BR')}</small><small className="order-secondary">{providerLabel}</small></td><td><strong>{order.customer_name}</strong>{order.customer_whatsapp ? <a className="order-whatsapp" href={`https://wa.me/${order.customer_whatsapp}`} target="_blank" rel="noreferrer">+{order.customer_whatsapp}</a> : <small className="order-secondary">WhatsApp não informado</small>}</td><td className="order-purchase"><button className="order-details-button" onClick={() => onDetails(order)}>Ver detalhes <ArrowUpRight size={15}/></button>{order.stock_issue && <small className="order-alert">Conferir estoque antes do envio</small>}{order.payment_issue && <small className="order-alert">Mais de um pagamento: conferir provedor</small>}</td><td>{money(order.total)}</td><td><label className={`status-pill payment-${order.payment_status}`}><i/>{paymentLabels[order.payment_status] || order.payment_status}{!online && <><select value={order.payment_status} onChange={(event) => onPayment(order, event.target.value)} aria-label={`Pagamento do pedido de ${order.customer_name}`}><option value="pending">Aguardando pagamento</option><option value="approved">Pagamento aprovado</option><option value="cancelled">Cancelado</option></select><ChevronDown size={12}/></>}</label>{online && <button className="order-sync" disabled={syncing === order.id} onClick={() => onSync(order)}><RefreshCw size={12} className={syncing === order.id ? 'spinning' : ''}/>{syncing === order.id ? 'Consultando…' : 'Atualizar pagamento'}</button>}</td><td><label className={`status-pill status-${order.status}`}><i/>{labels[order.status]}<select value={order.status} onChange={(event) => onStatus(order, event.target.value)} aria-label={`Operação do pedido de ${order.customer_name}`}>{allowed.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select><ChevronDown size={12}/></label></td></tr>;
  })}</tbody></table></div>;
}

function OrderDetails({ id, onClose }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);
  useDialog(panel, close);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setOrder(null);
    api(`/orders/${id}`).then((result) => { if (active) setOrder(result); }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [id, retry]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal order-details" role="dialog" aria-modal="true" aria-labelledby="order-details-title" ref={panel}>
      <div className="modal-heading"><div><p className="eyebrow">DETALHES DA COMPRA</p><h2 id="order-details-title">Pedido #{id}</h2></div><button onClick={close} aria-label="Fechar detalhes"><X size={20}/></button></div>
      {!order && !error && <p className="order-detail-loading" role="status">Carregando detalhes…</p>}
      {error && <div role="alert"><p className="form-error">{error}</p><button className="button button-light" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div>}
      {order && <>
        <div className="order-detail-summary"><span>{new Date(order.created_at).toLocaleString('pt-BR')}</span><span className={`status-pill payment-${order.payment_status}`}>{paymentLabels[order.payment_status] || order.payment_status}</span></div>
        <section className="order-detail-section"><h3>Cliente</h3><dl><div><dt>Nome</dt><dd>{order.customer_name}</dd></div><div><dt>E-mail</dt><dd>{order.customer_email ? <a href={`mailto:${order.customer_email}`}>{order.customer_email}</a> : 'Não informado'}</dd></div><div><dt>WhatsApp</dt><dd>{order.customer_whatsapp ? <a href={`https://wa.me/${order.customer_whatsapp}`} target="_blank" rel="noreferrer">+{order.customer_whatsapp}</a> : 'Não informado'}</dd></div></dl></section>
        <section className="order-detail-section"><h3>Endereço</h3><dl><div><dt>Endereço completo</dt><dd>{order.customer_address || 'Não informado neste pedido'}</dd></div><div><dt>Complemento</dt><dd>{order.customer_complement || 'Não informado'}</dd></div><div><dt>CEP</dt><dd>{order.customer_zipcode ? order.customer_zipcode.replace(/^(\d{5})(\d{3})$/, '$1-$2') : 'Não informado'}</dd></div></dl></section>
        <section className="order-detail-section"><h3>Itens comprados</h3>{order.items?.length ? <><ul className="order-detail-items">{order.items.map((item, index) => <li key={`${item.product_id}-${index}`}><div><strong>{item.name}</strong><small>{item.quantity} × {money(item.unit_price)}{item.sku && ` · ${item.sku}`}</small><p className="order-item-description">{item.description || 'Detalhes não registrados na época da compra.'}</p></div><strong>{money(Number(item.unit_price) * item.quantity)}</strong></li>)}</ul>{!['mercado_pago', 'pagbank'].includes(order.source) && order.purchase_description && <p className="order-item-description">Registro da venda: {order.purchase_description}</p>}</> : <p>{order.purchase_description || 'Itens não informados neste pedido'}</p>}</section>
        <div className="order-detail-total"><span>Valor total</span><strong>{money(order.total)}</strong></div>
        {Number(order.payment_refunded_amount) > 0 && <p>Valor reembolsado: {money(order.payment_refunded_amount)}</p>}
        {(order.pagbank_checkout_id || order.mp_order_id) && <p className="order-secondary order-mp-id">Referência de pagamento: {order.pagbank_checkout_id || order.mp_order_id}</p>}
      </>}
    </section>
  </div>;
}

function RepairSection({ repairs, pendingCount, onAdd, onStatus }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = Object.fromEntries(new FormData(formElement));
    form.value = Number(form.value);
    try {
      await onAdd(form);
      formElement.reset();
      setShowForm(false);
      setError('');
    } catch (reason) {
      setError(reason.message);
    }
  }

  return <section className="panel management-panel screen-reveal repair-management">
    <div className="panel-heading">
      <div><p className="eyebrow">ASSISTÊNCIA TÉCNICA</p><h2>Registro de reparos.</h2><p className="panel-subtitle">{pendingCount} pendentes · {repairs.length} registros</p></div>
      <button className="button button-dark" onClick={() => setShowForm(!showForm)}><Plus size={16}/>{showForm ? 'Fechar formulário' : 'Registrar reparo'}</button>
    </div>
    {showForm && <form className="repair-form" onSubmit={submit}>
      <label>Nome do reparo<input name="repair_name" required maxLength="160" placeholder="Ex.: Troca de tela"/></label>
      <div className="repair-form-row">
        <label>Nome do cliente<input name="customer_name" required maxLength="120" placeholder="Nome completo"/></label>
        <label>WhatsApp do cliente<input name="customer_whatsapp" type="tel" required minLength="10" maxLength="20" placeholder="(41) 99999-9999"/></label>
        <label>Valor (R$)<input name="value" type="number" min="0" step="0.01" required placeholder="0,00"/></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="repair-form-actions"><button className="button button-dark">Salvar reparo <ArrowRight size={15}/></button></div>
    </form>}
    {!repairs.length ? <div className="empty-state"><span><Wrench size={20}/></span><strong>Nenhum reparo registrado.</strong><p>Os novos serviços aparecerão nesta lista.</p></div> : <div className="table-scroll"><table className="orders-table repairs-table"><thead><tr><th>REPARO</th><th>CLIENTE</th><th>WHATSAPP</th><th>VALOR</th><th>DATA</th><th>ESTADO</th></tr></thead><tbody>{repairs.map((repair) => {
      const whatsapp = String(repair.customer_whatsapp || '').replace(/\D/g, '');
      return <tr key={repair.id}>
        <td><strong>{repair.repair_name}</strong></td>
        <td>{repair.customer_name}</td>
        <td><a className="repair-whatsapp" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">{repair.customer_whatsapp}</a></td>
        <td>{money(repair.value)}</td>
        <td>{new Date(repair.created_at).toLocaleDateString('pt-BR')}</td>
        <td><label className={`status-pill status-${repair.status}`}><i/>{repair.status === 'repaired' ? 'Reparado' : 'Pendente'}<select value={repair.status} onChange={(event) => onStatus(repair, event.target.value)} aria-label={`Estado do reparo ${repair.repair_name}`}><option value="pending">Pendente</option><option value="repaired">Reparado</option></select><ChevronDown size={12}/></label></td>
      </tr>;
    })}</tbody></table></div>}
  </section>;
}

function DashboardLoading({ section }) {
  const labels = ['Vendas no mês', 'Pedidos recebidos', 'Reparos pendentes', 'Itens no catálogo'];
  return <div className="dashboard-loading" role="status" aria-live="polite" aria-label="Carregando informações do painel">
    <p className="loading-caption"><span className="loading-dot"/> Preparando suas informações…</p>
    <div aria-hidden="true">{section === 'overview' ? <>
      <div className="skeleton-welcome"><span className="skeleton skeleton-line"/><span className="skeleton skeleton-title"/><span className="skeleton skeleton-line"/></div>
      <div className="stats-grid">{labels.map((label) => <article className="stat-card skeleton-stat" key={label}><div className="stat-head">{label}</div><span className="skeleton skeleton-value"/><span className="skeleton skeleton-line"/></article>)}</div>
      <div className="overview-grid"><div className="panel skeleton-panel"><span className="skeleton skeleton-title"/><div className="skeleton-chart">{[35, 60, 45, 80, 55, 95, 70].map((height, index) => <span className="skeleton" key={index} style={{ height: `${height}%` }}/>)}</div></div><div className="panel skeleton-panel"><span className="skeleton skeleton-title"/>{[0, 1, 2].map((row) => <div className="skeleton-row" key={row}><span className="skeleton skeleton-avatar"/><span className="skeleton skeleton-line"/></div>)}</div></div>
    </> : <div className="panel management-panel skeleton-panel"><span className="skeleton skeleton-title"/>{[0, 1, 2, 3].map((row) => <div className="skeleton-row" key={row}><span className="skeleton skeleton-avatar"/><span className="skeleton skeleton-line"/><span className="skeleton skeleton-short"/></div>)}</div>}</div>
  </div>;
}

function Dashboard() {
  const [theme, setTheme] = useState(() => readStored('luxphone-admin-theme', 'light') === 'dark' ? 'dark' : 'light');
  const [syncing, setSyncing] = useState(null);
  useEffect(() => { writeStored('luxphone-admin-theme', theme); }, [theme]);
  const [menuOpen, setMenuOpen] = useMobileMenu();
  const [section, setSection] = useState('overview'); const [summary, setSummary] = useState(null); const [products, setProducts] = useState([]); const [orders, setOrders] = useState([]); const [repairs, setRepairs] = useState([]); const [error, setError] = useState(''); const [modal, setModal] = useState(''); const [search, setSearch] = useState('');
  const [loadedSections, setLoadedSections] = useState({});
  const [requestState, setRequestState] = useState({ section: 'overview', status: 'loading' });
  const sectionReady = Boolean(loadedSections[section]);
  const sectionFailed = requestState.section === section && requestState.status === 'error';
  const refreshing = requestState.section === section && requestState.status === 'loading';
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setRequestState({ section, status: 'loading' });
    try {
      const [stats, catalog, sales, repairList] = await Promise.all([
        api('/dashboard/summary'),
        section === 'overview' || section === 'products' || section === 'orders' ? api('/products?all=true') : null,
        section === 'overview' || section === 'orders' ? api(section === 'overview' ? '/orders?recent=true' : '/orders') : null,
        section === 'repairs' ? api('/repairs') : null,
      ]);
      if (version !== refreshVersion.current) return;
      setSummary(stats);
      if (catalog) setProducts(catalog);
      if (sales) setOrders(sales);
      if (repairList) setRepairs(repairList);
      setError('');
      setLoadedSections((current) => ({ ...current, [section]: true }));
      setRequestState({ section, status: 'ready' });
    } catch (reason) {
      if (version === refreshVersion.current) {
        setError(reason.message);
        setRequestState({ section, status: 'error' });
      }
    }
  }, [section]);
  useEffect(() => {
    refresh();
    return () => { refreshVersion.current++; };
  }, [refresh]);
  async function logout() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); window.location.assign('/admin'); }
  async function saveProduct(event) { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); form.price = Number(form.price); form.stock = Number(form.stock); try { await api(modal.product ? `/products/${modal.product.id}` : '/products', { method: modal.product ? 'PUT' : 'POST', body: JSON.stringify(form) }); setModal(''); refresh(); } catch (reason) { setError(reason.message); } }
  async function removeProduct(product) { if (!window.confirm(`Remover ${product.name} do catálogo?`)) return; try { await api(`/products/${product.id}`, { method: 'DELETE' }); refresh(); } catch (reason) { setError(reason.message); } }
  async function addOrder(event) { event.preventDefault(); const form = Object.fromEntries(new FormData(event.currentTarget)); form.total = Number(form.total); try { await api('/orders', { method: 'POST', body: JSON.stringify(form) }); setModal(''); refresh(); } catch (reason) { setError(reason.message); } }
  async function changeStatus(order, status) { try { await api(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); refresh(); } catch (reason) { setError(reason.message); } }
  async function changePayment(order, payment_status) { try { await api(`/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify({ payment_status }) }); await refresh(); } catch (reason) { setError(reason.message); } }
  async function syncPayment(order) { setSyncing(order.id); try { await api(`/orders/${order.id}/sync-payment`, { method: 'POST' }); await refresh(); } catch (reason) { setError(reason.message); } finally { setSyncing(null); } }
  async function addRepair(form) { await api('/repairs', { method: 'POST', body: JSON.stringify(form) }); await refresh(); }
  async function changeRepairStatus(repair, status) { try { await api(`/repairs/${repair.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh(); } catch (reason) { setError(reason.message); } }
  const lowStock = products.filter((product) => product.stock <= 5); const filteredProducts = products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  const nav = [{ id: 'overview', title: 'Visão geral', icon: LayoutDashboard }, { id: 'products', title: 'Produtos', icon: Smartphone }, { id: 'orders', title: 'Pedidos', icon: Package }, { id: 'repairs', title: 'Reparos', icon: Wrench }];
  const maxSales = Math.max(1, ...(summary?.weeklySales || []).map((day) => Number(day.revenue)));
  return <div className="dashboard-shell" data-theme={theme}><aside id="dashboard-navigation" className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'}><button className="sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X size={22}/></button><div className="side-brand"><Brand/></div><div className="workspace-caption">WORKSPACE <ChevronDown size={13}/></div><div className="workspace-switch"><span className="workspace-letter">L</span><span><strong>LUX BATERIAS</strong><small>Loja principal</small></span><i/></div><p className="side-label">OPERAÇÃO</p><nav className="side-links">{nav.map(({ id, title, icon: Icon }) => <button key={id} className={section === id ? 'side-link selected' : 'side-link'} onClick={() => { setSection(id); setMenuOpen(false); }}><Icon size={17}/>{title}{id === 'products' && lowStock.length > 0 && <span className="side-badge">{lowStock.length}</span>}{id === 'repairs' && Number(summary?.pendingRepairs) > 0 && <span className="side-badge">{summary.pendingRepairs}</span>}</button>)}</nav><div className="side-bottom"><a href="/" className="side-link"><ArrowUpRight size={16}/> Ver loja</a><div className="profile"><span className="profile-letter">L</span><span><strong>Lucas</strong><small>Administrador</small></span><button onClick={logout} aria-label="Sair"><LogOut size={16}/></button></div></div></aside>
    {menuOpen && <button className="sidebar-overlay" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"/>}<main className="dashboard-main"><header className="dashboard-header"><button className="dashboard-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="dashboard-navigation"><Menu size={22}/></button><div><p className="breadcrumb">LUX BATERIAS <span>/</span> {nav.find((item) => item.id === section)?.title.toUpperCase()}</p><h1>{nav.find((item) => item.id === section)?.title}</h1></div><div className="dashboard-tools"><button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}</button><span className="live-label"><i/> Loja ativa</span><button className="icon-quiet" aria-label="Ajuda"><CircleHelp size={18}/></button><span className="user-chip">L</span></div></header>
      {error && <div className="dashboard-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar"><X size={16}/></button></div>}
      {!sectionReady && !sectionFailed && <DashboardLoading section={section}/>}
      {!sectionReady && sectionFailed && <div className="panel dashboard-load-error"><p>Não foi possível carregar as informações.</p><button className="button button-dark" onClick={refresh}>Tentar novamente <RefreshCw size={15}/></button></div>}
      {sectionReady && refreshing && <p className="dashboard-refresh-status" role="status"><span className="loading-dot"/> Atualizando informações…</p>}
      {section === 'overview' && sectionReady && <><section className="welcome-band screen-reveal"><div><span className="welcome-overline"><Sparkles size={14}/> {todayLabel}</span><h2>Um bom dia para vender, Lucas.</h2><p>Veja o ritmo da sua loja e o que merece atenção hoje.</p></div><div className="welcome-art"><Smartphone size={75} strokeWidth={0.8}/></div></section><section className="stats-grid screen-reveal"><Stat label="Vendas no mês" value={money(summary?.monthlyRevenue)} detail={`${money(summary?.monthlyRepairRevenue)} em reparos concluídos`} icon={CreditCard} accent/><Stat label="Pedidos recebidos" value={summary?.ordersThisMonth ?? '—'} detail={`${summary?.ordersToday || 0} hoje`} icon={Package}/><Stat label="Reparos pendentes" value={summary?.pendingRepairs ?? '—'} detail={summary?.pendingRepairs ? 'Ação necessária' : 'Tudo em dia'} icon={Wrench}/><Stat label="Itens no catálogo" value={summary?.productsCount ?? '—'} detail={lowStock.length ? `${lowStock.length} com estoque baixo` : 'Estoque saudável'} icon={Box}/></section><section className="overview-grid screen-reveal"><article className="panel sales-panel"><div className="panel-heading"><div><p className="eyebrow">DESEMPENHO</p><h2>Vendas da semana</h2></div><span className="period-select">Últimos 7 dias <ChevronDown size={14}/></span></div><div className="sales-total">{money(summary?.weeklyTotal)}<span><i/> Atualizado agora</span></div><div className="chart-area"><div className="chart-values"><span>{money(maxSales)}</span><span>{money(maxSales / 2)}</span><span>R$ 0</span></div><div className="chart"><div className="chart-lines"><i/><i/><i/></div><div className="bars">{(summary?.weeklySales || []).map((day) => <div className="bar-column" key={day.day}><div className="bar-track"><span style={{ height: `${Math.max(3, Number(day.revenue) / maxSales * 100)}%` }}/></div><small>{day.label}</small></div>)}</div></div></div></article><article className="panel attention-panel"><div className="panel-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Precisa de atenção</h2></div><span className="attention-number">{lowStock.length}</span></div>{lowStock.length ? lowStock.slice(0, 3).map((item) => <div className="attention-row" key={item.id}><span className="attention-icon"><Smartphone size={17}/></span><span><strong>{item.name}</strong><small>{item.stock ? `Só restam ${item.stock} unidades` : 'Sem estoque'}</small></span><b>{item.stock} un.</b></div>) : <div className="clear-state"><span><Check size={17}/></span><strong>Você está em dia.</strong><p>Os itens com pouco estoque aparecem aqui.</p></div>}<button className="text-action" onClick={() => setSection('products')}>Ver estoque completo <ArrowRight size={14}/></button></article></section><section className="panel recent-panel screen-reveal"><div className="panel-heading"><div><p className="eyebrow">MOVIMENTAÇÃO</p><h2>Pedidos recentes</h2></div><button className="text-action" onClick={() => setSection('orders')}>Todos os pedidos <ArrowRight size={14}/></button></div><OrderTable orders={orders.slice(0, 5)} onStatus={changeStatus} onPayment={changePayment} onSync={syncPayment} syncing={syncing} onDetails={(order) => setModal({ type: 'order-details', order })}/></section></>}
      {section === 'products' && sectionReady && <section className="panel management-panel screen-reveal"><div className="panel-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Seu estoque, de perto.</h2><p className="panel-subtitle">{products.length} produtos cadastrados · {lowStock.length} precisam de reposição</p></div><button className="button button-dark" onClick={() => setModal({ type: 'product' })}><Plus size={16}/> Adicionar produto</button></div><div className="table-tools"><label className="search-box"><Search size={16}/><input placeholder="Buscar produto ou SKU" value={search} onChange={(event) => setSearch(event.target.value)}/></label><span>{filteredProducts.length} resultados</span></div><div className="inventory-list">{filteredProducts.map((item) => <article className="inventory-item" key={item.id}><img src={item.image_url || sampleProducts[0].image_url} alt=""/><div className="inventory-name"><strong>{item.name}</strong><span>{item.sku} · {item.category}</span></div><span className="inventory-price">{money(item.price)}</span><span className={item.stock <= 5 ? 'inventory-level low' : 'inventory-level'}><i/>{item.stock} unidades</span><div className="inventory-actions"><button onClick={() => setModal({ type: 'product', product: item })}>Editar</button><button onClick={() => removeProduct(item)} aria-label={`Remover ${item.name}`}><X size={15}/></button></div></article>)}</div></section>}
      {section === 'orders' && sectionReady && <section className="panel management-panel screen-reveal"><div className="panel-heading"><div><p className="eyebrow">VENDAS</p><h2>Pedidos da loja.</h2><p className="panel-subtitle">Acompanhe cada pedido até a entrega.</p></div><button className="button button-dark" onClick={() => setModal({ type: 'order' })}><Plus size={16}/> Registrar pedido</button></div><OrderTable orders={orders} onStatus={changeStatus} onPayment={changePayment} onSync={syncPayment} syncing={syncing} onDetails={(order) => setModal({ type: 'order-details', order })}/></section>}
      {section === 'repairs' && sectionReady && <RepairSection repairs={repairs} pendingCount={summary?.pendingRepairs || 0} onAdd={addRepair} onStatus={changeRepairStatus}/>}
      <footer className="dashboard-footer"><span>LUX BATERIAS <i>·</i> Painel de operação</span><span>Histórico de pedidos e reparos: últimos 3 meses</span></footer></main>
    {modal?.type === 'order-details' && <OrderDetails id={modal.order.id} onClose={() => setModal('')}/>}
    {modal?.type === 'product' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(''); }}><form className="modal" onSubmit={saveProduct}><div className="modal-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>{modal.product ? 'Editar produto' : 'Novo produto'}</h2></div><button type="button" onClick={() => setModal('')} aria-label="Fechar"><X size={18}/></button></div><label>Nome do produto<input name="name" required defaultValue={modal.product?.name} placeholder="Ex.: iPhone 16 Pro"/></label><div className="form-row"><label>Marca<input name="category" required defaultValue={modal.product?.category} placeholder="Apple"/></label><label>SKU<input name="sku" required defaultValue={modal.product?.sku} placeholder="APL-16P"/></label></div><div className="form-row"><label>Preço (R$)<input name="price" type="number" min="0" step="0.01" required defaultValue={modal.product?.price}/></label><label>Unidades em estoque<input name="stock" type="number" min="0" required defaultValue={modal.product?.stock ?? 0}/></label></div><label>Categoria<select name="product_type" defaultValue={modal.product?.product_type || 'smartphones'}>{productTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label><label>Descrição e detalhes<textarea name="description" required minLength="1" maxLength="3000" rows="5" defaultValue={modal.product?.description} placeholder="Informe condição, especificações, garantia e outros detalhes relevantes."/></label><label>URL da imagem<input name="image_url" type="url" defaultValue={modal.product?.image_url} placeholder="https://..."/></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-light" onClick={() => setModal('')}>Cancelar</button><button className="button button-dark">Salvar produto <ArrowRight size={15}/></button></div></form></div>}
    {modal?.type === 'order' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(''); }}><form className="modal" onSubmit={addOrder}><div className="modal-heading"><div><p className="eyebrow">VENDAS</p><h2>Registrar pedido</h2></div><button type="button" onClick={() => setModal('')} aria-label="Fechar"><X size={18}/></button></div><label>Nome do cliente<input name="customer_name" required placeholder="Nome completo"/></label><label>WhatsApp com DDD<input name="customer_whatsapp" type="tel" required minLength={10} maxLength={20} placeholder="(41) 99999-9999"/></label><label>O que o cliente comprou<input name="purchase_description" required maxLength={1000} placeholder="Ex.: iPhone 16 Pro + capinha"/></label><label>Vincular produto do catálogo (opcional)<select name="product_id" defaultValue=""><option value="">Sem produto vinculado</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.price)}</option>)}</select></label><label>Pagamento<select name="payment_status" defaultValue="pending"><option value="pending">Aguardando pagamento</option><option value="approved">Pagamento recebido no balcão</option></select></label><label>Valor total (R$)<input name="total" type="number" min="0.01" step="0.01" required placeholder="0,00"/></label><label>Status<select name="status" defaultValue="pending"><option value="pending">Pendente</option><option value="paid">Pago</option><option value="shipped">Enviado</option><option value="delivered">Entregue</option></select></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-light" onClick={() => setModal('')}>Cancelar</button><button className="button button-dark">Registrar pedido <ArrowRight size={15}/></button></div></form></div>}
  </div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false); const [ready, setReady] = useState(false); const admin = window.location.pathname.startsWith('/admin');
  useEffect(() => { if (!admin) return; api('/auth/me').then(() => setAuthenticated(true)).catch(() => {}).finally(() => setReady(true)); }, [admin]);
  if (!admin) return <Storefront/>;
  if (!ready) return <div className="loading"><Brand/><span>Preparando seu espaço...</span></div>;
  return authenticated ? <Dashboard/> : <Login onLogin={() => setAuthenticated(true)}/>;
}
