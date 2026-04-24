import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 30, // 30 usuários simultâneos
  duration: '2m', // Duração total do teste
};

export default function () {
  const url = 'http://192.168.121.10:30554/svc1';
  
  const params = {
    headers: {
      'Authorization': `Bearer ${__ENV.TOKEN}`,
    },
  };

  http.get(url, params);
  sleep(0.1); // pausa de 100ms entre requisições
}