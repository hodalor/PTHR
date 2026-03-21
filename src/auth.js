export function decodeJwt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload || null;
  } catch (error) {
    return null;
  }
}

export function getStoredAuth() {
  try {
    const raw = window.localStorage.getItem('pthr_auth');
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export function storeAuth(auth) {
  try {
    if (!auth) {
      window.localStorage.removeItem('pthr_auth');
      return;
    }
    window.localStorage.setItem('pthr_auth', JSON.stringify(auth));
  } catch (error) {
    // ignore
  }
}

export function clearAuth() {
  try {
    window.localStorage.removeItem('pthr_auth');
  } catch (error) {
    // ignore
  }
}

