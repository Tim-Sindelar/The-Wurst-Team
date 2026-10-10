import { client } from './generated/client.gen';

client.setConfig({
  baseUrl:
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.BASE_URL.replace(/\/$/, ''),
});

export { client };
