// Маленький клиент к Supabase на обычном fetch: вход, таблицы, хранилище.
// Без внешних библиотек, чтобы сайту не нужно было ничего грузить с CDN.
(function () {
    'use strict';
    const C = window.SITE_CONFIG;
    const SESSION_KEY = 'ns.session';
    const URLS_KEY = 'ns.signed-urls';
    const SIGN_TTL = 24 * 60 * 60;      // ссылка на фото живёт сутки
    const SIGN_MARGIN = 60 * 60;        // обновляем, если осталось меньше часа

    class ApiError extends Error {
        constructor(message, status, code) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    // ---------- сессия ----------
    function readSession() {
        try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
    }
    function writeSession(s) {
        session = s;
        try {
            if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
            else localStorage.removeItem(SESSION_KEY);
        } catch (e) { /* приватный режим — живём без сохранения */ }
    }
    let session = readSession();
    let refreshing = null;

    const nowSec = () => Math.floor(Date.now() / 1000);

    const AUTH_MESSAGES = {
        invalid_credentials: 'Неверная почта или пароль',
        email_not_confirmed: 'Почта не подтверждена. Отметь пользователя как подтверждённого в Supabase.',
        user_banned: 'Этот аккаунт заблокирован',
        over_request_rate_limit: 'Слишком много попыток. Подожди минуту и попробуй снова.',
        over_email_send_rate_limit: 'Слишком много писем подряд. Подожди немного и попробуй снова.',
        same_password: 'Новый пароль совпадает со старым',
        weak_password: 'Пароль слишком простой: нужно хотя бы 6 символов',
        email_exists: 'Эта почта уже занята другим аккаунтом',
        email_address_invalid: 'Почта указана с ошибкой',
        validation_failed: 'Почта указана с ошибкой',
        reauthentication_needed: 'Для смены пароля нужно заново войти на сайт'
    };

    async function toError(res) {
        let body = null;
        try { body = await res.json(); } catch (e) { /* не JSON */ }
        const code = body && (body.error_code || body.code || body.error) || '';
        let message = AUTH_MESSAGES[code]
            || (body && (body.msg || body.message || body.error_description))
            || `Ошибка сервера (${res.status})`;
        if (res.status === 413) message = 'Файл слишком большой';
        return new ApiError(message, res.status, code);
    }

    async function safeFetch(url, init) {
        try {
            return await fetch(url, init);
        } catch (e) {
            throw new ApiError('Нет связи с сервером. Проверь интернет и попробуй ещё раз.', 0, 'network');
        }
    }

    async function tokenRequest(grant, payload) {
        const res = await safeFetch(`${C.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
            method: 'POST',
            headers: { apikey: C.supabaseKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw await toError(res);
        const d = await res.json();
        const s = {
            access_token: d.access_token,
            refresh_token: d.refresh_token,
            expires_at: d.expires_at || (nowSec() + (d.expires_in || 3600)),
            user: { id: d.user && d.user.id, email: d.user && d.user.email }
        };
        writeSession(s);
        return s;
    }

    const api = {
        ApiError,
        onAuthLost: null,

        get user() { return session ? session.user : null; },
        get signedIn() { return !!session; },

        signIn(email, password) {
            return tokenRequest('password', { email: email.trim(), password });
        },

        async signOut() {
            const s = session;
            writeSession(null);
            try { localStorage.removeItem(URLS_KEY); } catch (e) { /* ignore */ }
            urlCache.clear();
            if (s) {
                safeFetch(`${C.supabaseUrl}/auth/v1/logout`, {
                    method: 'POST',
                    headers: { apikey: C.supabaseKey, Authorization: `Bearer ${s.access_token}` }
                }).catch(() => {});
            }
        },

        async token(force) {
            if (!session) throw new ApiError('Нужно войти заново', 401, 'no_session');
            // другая вкладка могла уже обновить токен
            const stored = readSession();
            if (stored && stored.expires_at > session.expires_at) session = stored;
            if (!force && session.expires_at - nowSec() > 60) return session.access_token;
            if (!refreshing) {
                refreshing = tokenRequest('refresh_token', { refresh_token: session.refresh_token })
                    .catch((e) => {
                        if (e.status >= 400 && e.status < 500) {
                            writeSession(null);
                            if (api.onAuthLost) api.onAuthLost();
                            throw new ApiError('Сессия закончилась, войди заново', 401, 'session_expired');
                        }
                        throw e;
                    })
                    .finally(() => { refreshing = null; });
            }
            return (await refreshing).access_token;
        },

        async request(path, opts) {
            opts = opts || {};
            const send = async (force) => {
                const headers = Object.assign({
                    apikey: C.supabaseKey,
                    Authorization: `Bearer ${await api.token(force)}`
                }, opts.headers || {});
                let body = opts.body;
                if (body !== undefined && !(body instanceof Blob) && typeof body !== 'string') {
                    headers['Content-Type'] = 'application/json';
                    body = JSON.stringify(body);
                }
                return safeFetch(C.supabaseUrl + path, { method: opts.method || 'GET', headers, body });
            };
            let res = await send(false);
            if (res.status === 401) res = await send(true);   // токен могли отозвать — пробуем обновить один раз
            if (!res.ok) throw await toError(res);
            if (res.status === 204) return null;
            const text = await res.text();
            if (!text) return null;
            try { return JSON.parse(text); } catch (e) { return text; }
        },

        // Смена почты или пароля текущего пользователя
        updateUser(patch) {
            return api.request('/auth/v1/user', { method: 'PUT', body: patch });
        },

        // ---------- таблицы ----------
        select(table, params) {
            return api.request(`/rest/v1/${table}?${new URLSearchParams(params)}`);
        },
        async insert(table, row) {
            const r = await api.request(`/rest/v1/${table}`, {
                method: 'POST', body: row, headers: { Prefer: 'return=representation' }
            });
            return Array.isArray(r) ? r[0] : r;
        },
        async update(table, id, patch) {
            const r = await api.request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
                method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' }
            });
            if (!Array.isArray(r) || !r.length) throw new ApiError('Запись не найдена — возможно, её уже удалили', 404, 'not_found');
            return r[0];
        },
        remove(table, id) {
            return api.request(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
        },

        // ---------- хранилище ----------
        upload(path, blob) {
            return api.request(`/storage/v1/object/${C.bucket}/${path}`, {
                method: 'POST',
                body: blob,
                headers: {
                    'Content-Type': blob.type || 'image/jpeg',
                    'cache-control': 'max-age=31536000',
                    'x-upsert': 'false'
                }
            });
        },
        async removeFiles(paths) {
            paths = (paths || []).filter(Boolean);
            if (!paths.length) return;
            paths.forEach((p) => urlCache.delete(p));
            persistUrls();
            await api.request(`/storage/v1/object/${C.bucket}`, { method: 'DELETE', body: { prefixes: paths } });
        },

        // Подписанные ссылки на приватные фото. Кешируем, чтобы браузер
        // повторно брал картинки из своего кеша, а не скачивал заново.
        async signedUrls(paths) {
            const out = {};
            const missing = [];
            const limit = nowSec() + SIGN_MARGIN;
            for (const p of new Set(paths.filter(Boolean))) {
                const hit = urlCache.get(p);
                if (hit && hit.exp > limit) out[p] = hit.url;
                else missing.push(p);
            }
            for (let i = 0; i < missing.length; i += 100) {
                const chunk = missing.slice(i, i + 100);
                const res = await api.request(`/storage/v1/object/sign/${C.bucket}`, {
                    method: 'POST', body: { expiresIn: SIGN_TTL, paths: chunk }
                });
                const exp = nowSec() + SIGN_TTL;
                for (const item of res || []) {
                    if (!item || item.error || !item.signedURL) continue;
                    const url = C.supabaseUrl + '/storage/v1' + item.signedURL;
                    urlCache.set(item.path, { url, exp });
                    out[item.path] = url;
                }
            }
            if (missing.length) persistUrls();
            return out;
        }
    };

    // ---------- кеш ссылок ----------
    const urlCache = new Map();
    try {
        const raw = JSON.parse(localStorage.getItem(URLS_KEY) || '{}');
        const t = nowSec();
        for (const k of Object.keys(raw)) if (raw[k].exp > t) urlCache.set(k, raw[k]);
    } catch (e) { /* ignore */ }

    let persistTimer = null;
    function persistUrls() {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            try {
                const t = nowSec();
                const obj = {};
                for (const [k, v] of urlCache) if (v.exp > t) obj[k] = v;
                localStorage.setItem(URLS_KEY, JSON.stringify(obj));
            } catch (e) { /* переполнено или приватный режим */ }
        }, 300);
    }

    window.api = api;
})();
