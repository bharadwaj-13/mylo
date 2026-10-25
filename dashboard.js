(() => {
  const cfg = window.__MYLO_CONFIG__ || {};
  const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((value || 0) / 100);
  const text = (value = '') => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const toast = value => { const el = document.getElementById('toast'); el.textContent = value; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500); };
  const client = () => window.myloSupabase || null;
  async function refresh() {
    const sb = client(); if (!sb || !(await sb.auth.getSession()).data.session) return;
    const { data: jobs, error } = await sb.from('shopping_jobs').select('id,request_text,status,selected_store,handoff_url,created_at,quotes(store,total_paise,eta_minutes,recommended,cart_url),job_events(event_type,message,created_at)').order('created_at', { ascending: false }).limit(8);
    if (error) return console.warn(error);
    const orderRows = document.getElementById('orderRows'); const activity = document.getElementById('activityList');
    if (!jobs?.length) { orderRows.innerHTML = '<tr><td class="empty" colspan="5">No requests yet — start a browser shopping run.</td></tr>'; activity.innerHTML = '<div class="empty">Your browser activity will appear here.</div>'; return; }
    orderRows.innerHTML = jobs.map(j => { const quote = j.quotes?.find(q => q.recommended) || j.quotes?.[0]; const store = j.selected_store || quote?.store || 'Comparing'; return `<tr><td><b>${text(j.id.slice(0, 8))}</b><div class="order-id">${text(j.request_text.slice(0, 38))}</div></td><td>${text(store)}</td><td><b>${quote ? money(quote.total_paise) : '—'}</b></td><td><span class="state ${/failed|needs/.test(j.status) ? 'pending' : 'success'}">${text(j.status.replaceAll('_', ' '))}</span></td><td>${new Date(j.created_at).toLocaleDateString('en-IN')}</td></tr>`; }).join('');
    activity.innerHTML = jobs.slice(0, 3).map(j => { const event = j.job_events?.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0]; return `<div class="activity-row"><div class="activity-icon">${j.status === 'failed' ? '!' : j.status === 'cart_ready' ? '🛒' : '◌'}</div><div class="activity-copy"><b>${text(event?.message || j.request_text)}</b><span>${text(j.status.replaceAll('_', ' '))}</span></div><span class="state ${j.status.includes('needs') ? 'pending' : 'success'}">${new Date(j.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></div>`; }).join('');
  }
  async function createJob() {
    const sb = client(); if (!sb) return toast('Sign in first.'); const request = document.getElementById('requestInput').value.trim(); if (!request) return;
    const budget = (request.match(/(?:₹|rs\.?|under)\s*([\d,]+)/i)?.[1] || '').replace(',', '');
    const { error } = await sb.from('shopping_jobs').insert({ request_text: request, source: 'dashboard', budget_paise: budget ? Number(budget) * 100 : null });
    if (error) return toast(error.message.includes('shopping_jobs') ? 'Run the Mylo Supabase schema first.' : error.message);
    document.getElementById('requestModal').classList.remove('open'); toast('Mylo queued your browser shopping session.'); refresh();
  }
  async function linkWhatsApp() {
    const sb = client(); if (!sb) return toast('Sign in first.');
    const raw = window.prompt('Enter the WhatsApp number you will text Mylo from, including country code (for example +919876543210).');
    if (!raw) return; const phone = raw.replace(/[^\d+]/g, '');
    if (!/^\+\d{8,15}$/.test(phone)) return toast('Use a full international number, beginning with +.');
    const user = (await sb.auth.getUser()).data.user; if (!user) return toast('Sign in first.');
    const { error } = await sb.from('profiles').upsert({ id: user.id, phone }, { onConflict: 'id' });
    toast(error ? error.message : 'WhatsApp number linked. You can text Mylo now.');
  }
  function attach() {
    document.title = 'Mylo — shopping operator'; document.querySelector('.brand').innerHTML = 'My<span>lo</span>';
    document.querySelector('.topbar h1').textContent = 'Your shopping operator'; document.querySelector('.topbar p').textContent = 'Live store sessions, cart comparison, and UPI approval — all under your control.';
    document.querySelector('.hero h2').textContent = 'What should Mylo shop for you?'; document.querySelector('.hero p').textContent = 'Mylo opens your connected store sessions, compares real carts, and stops for your approval before official UPI checkout.';
    const compare = document.getElementById('compareBtn'); compare.onclick = createJob; compare.textContent = 'Start browser run';
    const viewer = document.createElement('button'); viewer.className = 'secondary'; viewer.textContent = '◉ Open secure browser viewer'; viewer.style.marginTop = '8px'; viewer.onclick = () => cfg.viewerUrl ? window.open(cfg.viewerUrl, '_blank', 'noopener') : toast('The viewer becomes available after the browser worker is deployed.'); document.querySelector('.side-bottom').append(viewer);
    const phone = document.createElement('button'); phone.className = 'secondary'; phone.textContent = '☏ Link WhatsApp number'; phone.style.marginTop = '8px'; phone.onclick = linkWhatsApp; document.querySelector('.side-bottom').append(phone);
    refresh(); setInterval(refresh, 12000);
  }
  window.addEventListener('mylo-authenticated', attach); setTimeout(attach, 700);
})();
