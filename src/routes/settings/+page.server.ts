import { fail } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { addDevice, listDevices, removeDevice } from '$lib/server/devices';
import type { Actions, PageServerLoad } from './$types';

const KNOWN = ['iphone', 'pc', 'fedora'];

export const load: PageServerLoad = ({ cookies }) => {
  const d = drawer();
  return {
    chosen: cookies.get('drawer_device') ?? null,
    devices: listDevices(d.db),
    stats: d.stats(),
    modelAvailable: d.modelAvailable(),
  };
};

export const actions: Actions = {
  device: async ({ request, cookies, url }) => {
    const name = String((await request.formData()).get('device') ?? '');
    if (!KNOWN.includes(name)) return fail(400, { error: 'Pick one of your devices.' });
    cookies.set('drawer_device', name, {
      path: '/',
      maxAge: 60 * 60 * 24 * 400,
      sameSite: 'lax',
      httpOnly: true,
      secure: url.protocol === 'https:',
    });
    return { done: 'This device is set.' };
  },
  token: async ({ request }) => {
    const name = String((await request.formData()).get('name') ?? '');
    if (!KNOWN.includes(name)) return fail(400, { error: 'Pick one of your devices.' });
    const token = addDevice(drawer().db, name, name);
    return { token, tokenFor: name };
  },
  forget: async ({ request }) => {
    const name = String((await request.formData()).get('name') ?? '');
    removeDevice(drawer().db, name);
    return { done: 'Token removed. That device can no longer use the API until it gets a new one.' };
  },
};
