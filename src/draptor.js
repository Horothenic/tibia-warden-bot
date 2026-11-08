const API = 'https://tibiadraptor.com/api/v1/user/profile';
const TIMEOUT_MS = 8000;
const PAGE_LIMIT = 3;

export async function missingWardens(username, character, fetchImpl = fetch) {
  const profile = await post(fetchImpl, '/characters', { username, character });
  const found = (profile.characters ?? []).find((entry) => (
    String(entry.name ?? '').toLowerCase() === character.toLowerCase()
  ));
  if (!found) {
    const error = new Error('That character is not on that TibiaDraptor account.');
    error.code = 'missing-character';
    throw error;
  }
  if (Number(found.isHidden) === 1) {
    const error = new Error('That TibiaDraptor profile is hidden. Make the character public and try again.');
    error.code = 'hidden';
    throw error;
  }

  const missing = [];
  let page = 1;
  let lastPage = 1;
  do {
    const body = await post(fetchImpl, '/echo-wardens', {
      status: ['locked'],
      search: '',
      class_id: [],
      difficulty: [],
      occurrence: [],
      released: '',
      sortBy: 'name',
      order: 'asc',
      page,
      elementsToShow: 740,
      charactersToLoad: [{ id: found.id, name: found.name }],
    });
    lastPage = Number(body.meta?.last_page) || 1;
    for (const row of body.data ?? []) {
      const mine = (row.characters ?? []).find((entry) => Number(entry.id) === Number(found.id));
      if (mine && mine.echo_warden === false && row.name) missing.push(row.name);
    }
    page += 1;
  } while (page <= lastPage && page <= PAGE_LIMIT);

  return { characterId: found.id, missing };
}

async function post(fetchImpl, path, payload) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw failure();
  }
  if (!response.ok) throw failure();
  try {
    return await response.json();
  } catch {
    throw failure();
  }
}

function failure() {
  const error = new Error('TibiaDraptor did not answer. Nothing was saved.');
  error.code = 'failed';
  return error;
}
