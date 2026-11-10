// Общие кусочки интерфейса: создание элементов, сообщения, окна,
// выбор фото, фон страницы и просмотр фото на весь экран.
(function () {
    'use strict';

    const ui = {};

    // ---------- элементы (только textContent — никакого HTML из базы) ----------
    ui.el = function (tag, attrs, ...children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v === null || v === undefined || v === false) continue;
                if (k === 'class') node.className = v;
                else if (k === 'text') node.textContent = v;
                else if (k === 'style') node.style.cssText = v;
                else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
                else if (k === 'dataset') Object.assign(node.dataset, v);
                else if (v === true) node.setAttribute(k, '');
                else node.setAttribute(k, v);
            }
        }
        for (const c of children.flat()) {
            if (c === null || c === undefined || c === false) continue;
            node.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return node;
    };

    // SVG-элемент (для сердечка без фото)
    ui.svg = function (viewBox, pathD, fill) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', pathD);
        if (fill) path.setAttribute('fill', fill);
        svg.append(path);
        return svg;
    };

    // 'YYYY-MM-DD' -> '12.05.2025' (без сдвигов часовых поясов)
    ui.formatDate = function (iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}.${m}.${y}`;
    };
    ui.todayIso = function () {
        const t = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
    };
    ui.isMobile = () => window.matchMedia('(max-width: 768px)').matches;
    ui.canHover = () => window.matchMedia('(hover: hover)').matches;

    // ---------- всплывающее сообщение ----------
    let toastTimer = null;
    ui.toast = function (message, kind) {
        const t = document.getElementById('toast');
        t.textContent = message;
        t.className = 'toast' + (kind ? ' toast-' + kind : '');
        t.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 6000 : 3000);
    };
    ui.error = (e) => ui.toast((e && e.message) || 'Что-то пошло не так', 'error');

    // ---------- окна ----------
    const openStack = [];
    let lastFocus = null;

    ui.openModal = function (modal) {
        if (!openStack.length) lastFocus = document.activeElement;
        modal.hidden = false;
        if (!openStack.includes(modal)) openStack.push(modal);
        document.body.classList.add('modal-open');
        const focusable = modal.querySelector('input:not([type=file]):not([type=date]), textarea, [data-answer=no]');
        if (focusable && !ui.isMobile()) setTimeout(() => focusable.focus(), 60);
    };
    ui.closeModal = function (modal) {
        modal.hidden = true;
        const i = openStack.indexOf(modal);
        if (i >= 0) openStack.splice(i, 1);
        if (!openStack.length) {
            document.body.classList.remove('modal-open');
            if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
        }
    };
    ui.topModal = () => openStack[openStack.length - 1] || null;

    // Esc закрывает верхнее окно; клик по тёмному фону — тоже (кроме форм с текстом)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const top = ui.topModal();
        if (!top) return;
        const btn = top.querySelector('[data-close]') || top.querySelector('[data-answer=no]');
        if (btn) btn.click();
    });

    // ---------- подтверждение ----------
    ui.confirm = function (text, okLabel) {
        const modal = document.getElementById('confirmModal');
        modal.querySelector('.confirm-text').textContent = text;
        const yes = modal.querySelector('[data-answer=yes]');
        const no = modal.querySelector('[data-answer=no]');
        yes.textContent = okLabel || 'Удалить';
        ui.openModal(modal);
        return new Promise((resolve) => {
            const done = (answer) => {
                yes.onclick = no.onclick = modal.onclick = null;
                ui.closeModal(modal);
                resolve(answer);
            };
            yes.onclick = () => done(true);
            no.onclick = () => done(false);
            modal.onclick = (e) => { if (e.target === modal) done(false); };
        });
    };

    // ---------- блокировка кнопки на время сохранения ----------
    ui.busy = function (button, text) {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = text;
        return {
            text(t) { button.textContent = t; },
            done() { button.disabled = false; button.textContent = original; }
        };
    };

    // ---------- «⋮» на телефоне: показывает спрятанные кнопки ----------
    // На компьютере кнопки появляются при наведении (это делает CSS).
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('.micro-trigger-btn');
        document.querySelectorAll('.delete-action-container.show-action').forEach((c) => {
            if (!trigger || c !== trigger.parentElement) c.classList.remove('show-action');
        });
        if (trigger) {
            e.stopPropagation();
            trigger.parentElement.classList.toggle('show-action');
        }
    }, true);

    // ---------- выбор фото в форме ----------
    ui.photoPicker = function (area) {
        const input = area.querySelector('input[type=file]');
        const preview = area.querySelector('.photo-preview');
        const placeholder = area.querySelector('.polaroid-placeholder');
        const placeholderText = area.querySelector('.placeholder-text');
        const plus = area.querySelector('.plus-icon');
        const initialText = placeholderText.textContent;
        const removeBtn = area.querySelector('.photo-remove');
        let objectUrl = null;
        const state = { files: [], removed: false, hadExisting: false };

        const show = (src) => {
            preview.src = src;
            preview.hidden = false;
            placeholder.hidden = true;
            if (removeBtn) removeBtn.hidden = false;
        };
        const clear = () => {
            preview.removeAttribute('src');
            preview.hidden = true;
            placeholder.hidden = false;
            if (removeBtn) removeBtn.hidden = true;
            placeholderText.textContent = initialText;
            plus.textContent = '+';
        };
        const revoke = () => { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; } };

        area.addEventListener('click', (e) => { if (e.target !== removeBtn) input.click(); });
        area.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === area) { e.preventDefault(); input.click(); }
        });

        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            if (!files.length) return;
            state.files = files;
            revoke();
            if (files.length === 1) {
                objectUrl = URL.createObjectURL(files[0]);
                show(objectUrl);
            } else {
                preview.hidden = true;
                placeholder.hidden = false;
                plus.textContent = '📸';
                placeholderText.textContent = `Выбрано фото: ${files.length}`;
            }
        });

        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                revoke();
                input.value = '';
                state.files = [];
                state.removed = state.hadExisting;
                clear();
            });
        }

        return {
            reset(existingUrl) {
                revoke();
                input.value = '';
                state.files = [];
                state.removed = false;
                state.hadExisting = !!existingUrl;
                if (existingUrl) show(existingUrl); else clear();
            },
            get file() { return state.files[0] || null; },
            get files() { return state.files.slice(); },
            get removed() { return state.removed; },
            get dirty() { return state.files.length > 0 || state.removed; }
        };
    };

    // ---------- фон ----------
    // names — список имён картинок по порядку предпочтения (без .jpg).
    // Для каждого имени на телефоне сначала пробуем «имя_mobile.jpg».
    // Если ничего не нашлось — main.jpg, а если нет и его — белый фон.
    const bgKnown = new Map();
    let bgCurrent = null;
    let bgToken = 0;

    function probe(src) {
        if (bgKnown.has(src)) return Promise.resolve(bgKnown.get(src));
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { bgKnown.set(src, true); resolve(true); };
            img.onerror = () => { bgKnown.set(src, false); resolve(false); };
            img.src = src;
        });
    }

    ui.setBackground = async function (names) {
        const mobile = ui.isMobile();
        const list = [];
        for (const n of [].concat(names, 'main')) {
            if (mobile) list.push(`${n}_mobile`);
            list.push(n);
        }
        const token = ++bgToken;
        for (const n of list) {
            const src = `img/${n}.jpg`;
            if (await probe(src)) {
                if (token !== bgToken || src === bgCurrent) return;
                const bg = document.getElementById('bg');
                bg.style.opacity = '0.3';
                setTimeout(() => {
                    if (token !== bgToken) return;
                    bg.src = src;
                    bg.style.opacity = '1';
                    bgCurrent = src;
                }, 250);
                return;
            }
        }
    };

    // ---------- бесконечная подгрузка (вертикальная или внутри ленты) ----------
    ui.infinite = function (sentinel, load, root) {
        let busy = false;
        const io = new IntersectionObserver(async (entries) => {
            if (!entries.some((e) => e.isIntersecting) || busy) return;
            busy = true;
            let more = false;
            try { more = await load(); } catch (e) { ui.error(e); } finally { busy = false; }
            if (!more) return io.disconnect();
            if (sentinel.isConnected) { io.unobserve(sentinel); io.observe(sentinel); }
        }, { root: root || null, rootMargin: '600px' });
        io.observe(sentinel);
        return () => io.disconnect();
    };

    // ---------- колесо мыши листает горизонтальную ленту ----------
    ui.wheelToHorizontal = function (scroller, target, speed) {
        target.addEventListener('wheel', (e) => {
            if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            e.preventDefault();
            scroller.scrollLeft += e.deltaY * (speed || 1);
        }, { passive: false });
    };

    // ---------- фото на весь экран (полароид) ----------
    // items: [{ path, thumb_path, ... }]; opts: { getMore, hasMore, onDelete }
    ui.lightbox = function (items, index, opts) {
        opts = opts || {};
        const box = document.getElementById('fullscreenOverlay');
        const wrapper = box.querySelector('.fullscreen-polaroid-wrapper');
        const img = box.querySelector('.lightbox-img');
        const loader = box.querySelector('.lightbox-loader');
        const actions = box.querySelector('.delete-action-container');
        const delBtn = box.querySelector('.fullscreen-delete-btn');
        const prev = box.querySelector('.left-arrow');
        const next = box.querySelector('.right-arrow');
        const close = box.querySelector('.lightbox-close');
        const state = { items, index };
        let token = 0;

        async function render() {
            const item = state.items[state.index];
            if (!item) return close.click();
            const my = ++token;
            prev.hidden = state.index <= 0;
            next.hidden = state.index >= state.items.length - 1 && !(opts.hasMore && opts.hasMore());
            actions.hidden = !opts.onDelete;
            actions.classList.remove('show-action');
            // заранее задаём пропорции, чтобы рамка не прыгала
            if (item.width && item.height) img.style.aspectRatio = `${item.width} / ${item.height}`;
            loader.hidden = false;
            try {
                const urls = await api.signedUrls([item.thumb_path, item.path]);
                if (my !== token) return;
                if (urls[item.thumb_path]) img.src = urls[item.thumb_path];
                const full = new Image();
                full.onload = () => { if (my === token) { img.src = full.src; loader.hidden = true; } };
                full.onerror = () => { if (my === token) loader.hidden = true; };
                full.src = urls[item.path];
            } catch (e) {
                loader.hidden = true;
                ui.error(e);
            }
        }

        async function go(step) {
            const target = state.index + step;
            if (target >= state.items.length && opts.getMore) {
                if (!(await opts.getMore())) return;
            }
            if (target < 0 || target >= state.items.length) return;
            state.index = target;
            render();
        }

        function onKey(e) {
            if (ui.topModal() !== box) return;
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
        }

        prev.onclick = (e) => { e.stopPropagation(); go(-1); };
        next.onclick = (e) => { e.stopPropagation(); go(1); };
        close.onclick = (e) => {
            if (e) e.stopPropagation();
            token++;
            img.removeAttribute('src');
            document.removeEventListener('keydown', onKey);
            ui.closeModal(box);
        };
        box.onclick = (e) => { if (e.target === box) close.click(); };
        wrapper.onclick = (e) => e.stopPropagation();
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            const ok = await opts.onDelete(state.items[state.index]);
            if (!ok) return;
            if (!state.items.length) return close.click();
            if (state.index >= state.items.length) state.index = state.items.length - 1;
            render();
        };
        document.addEventListener('keydown', onKey);

        // свайпы на телефоне: влево/вправо — листать, вниз — закрыть
        let sx = null, sy = null;
        box.ontouchstart = (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; };
        box.ontouchend = (e) => {
            if (sx === null) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;
            sx = sy = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
            else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) close.click();
        };

        ui.openModal(box);
        render();
    };

    window.ui = ui;
})();
