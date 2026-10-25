// Isolated test sessions only. Never prints or persists session cookies.
export class Client {
  #cookie='';
  constructor(base='http://127.0.0.1:8007'){if(base!=='http://127.0.0.1:8007')throw Error('QA helper is restricted to the synthetic fixture.');this.base=base;}
  async request(route,data,options={}){
    const response=await fetch(this.base+route,{method:data===undefined?'GET':'POST',headers:{Cookie:this.#cookie,...(data===undefined?{}:{'X-Hik-Local':'1','Content-Type':'application/json'}),...options.headers},...(data===undefined?{}:{body:options.raw?data:JSON.stringify(data)})});
    const cookie=response.headers.get('set-cookie');if(cookie)this.#cookie=cookie.split(';')[0];
    const body=response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
    return {status:response.status,body,headers:{type:response.headers.get('content-type'),range:response.headers.get('content-range')}};
  }
  login(email,password='synthetic-password-42'){return this.request('/api/auth/login',{email,password});}
}
