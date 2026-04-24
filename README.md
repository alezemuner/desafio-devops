# Desafio DevOps - Service Mesh com Istio

> Implementação de uma Service Mesh segura com Kubernetes (k3s), Istio e políticas de autenticação/autorização.

---

## Sumário

1. [Visão Geral](#visão-geral)
2. [Pré-requisitos](#pré-requisitos)
3. [Provisionamento do Cluster](#1--provisionando-o-cluster)
4. [Service Mesh com Istio](#2--service-mesh-com-istio)
5. [Namespaces e Injeção Automática](#3--criar-os-namespaces-e-ativar-a-injeção-automática)
6. [Política mTLS STRICT](#4--configurar-política-de-mtls-em-modo-strict)
7. [Deploy dos Serviços](#5--subir-os-serviços)
8. [Regras de Roteamento](#6--regras-de-roteamento)
9. [Políticas de Segurança](#7--políticas-de-segurança-e-autenticação-jwt)
10. [Validação](#8--validação)
11. [Autoscaling com KEDA](#9---autoscaling-com-keda-e-prometheus)

---

## Visão Geral

Para esse desafio utilizei uma instância do Oracle Linux Server release 9.7 (Hiper-V) com 12 VCPUs, 12GB de RAM e 100GB de armazenamento.

### Topologia

O cluster é composto por:
- **1 nó control-plane**
- **2 nós worker**

A topologia baseia-se em três microsserviços rodando em namespaces isolados, protegidos por políticas **Deny-by-Default**. O tráfego externo é controlado por um Gateway que exige autenticação JWT, garantindo que apenas clientes autorizados possam acessar os serviços.

### Tecnologias

| Componente | Função |
|------------|--------|
| **k3s** | Kubernetes leve para o cluster |
| **Istio** | Service Mesh para segurança e roteamento |
| **Vagrant + Libvirt** | Provisionamento de VMs |
| **Helm** | Gerenciador de pacotes para Service 2 |

Utilizei Vagrant para facilitar a automação e reprodutibilidade e o Libivirt para aproveitar a virtualização nativa do kernel Linux.

### Arquitetura de Segurança

- **mTLS**: Ativo globalmente em modo STRICT nos 3 namespaces
- **JWT**: Validação nos namespaces service-1 e service-3
- **Authorization Policies**: Controle granular de acesso entre serviços

> **Nota**: O JWKS foi configurado com a URI pública do repositório oficial do Istio. O token utilizado é o `demo.jwt` pré-assinado por `testing@secure.istio.io`.

---

## Pré-requisitos

Instalação do Vagrant e libvirt no Host para criação as VMs necessárias para o cluster k3s.

```bash
# Instalação do libvirt:
sudo dnf install -y qemu-kvm libvirt virt-install virt-viewer
sudo systemctl enable --now libvirtd
sudo usermod -aG libvirt $(whoami)
newgrp libvirt

# Instalação do Vagrant:
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://rpm.releases.hashicorp.com/RHEL/hashicorp.repo
sudo dnf install -y vagrant

# Plugin do Vagrant para libvirt:
sudo dnf config-manager --enable ol9_codeready_builder
sudo dnf install -y gcc libvirt-devel ruby-devel qemu-kvm
vagrant plugin install vagrant-libvirt
```

>  **Importante**: Precisei habilitar a extensão de virtualização na VM Oracle Linux para que as VMs criadas pelo Vagrant possam utilizar a virtualização aninhada:
> ```powershell
> # Executar como administrador no host com a Vm desligada:
> Set-VMProcessor -VMName "nome-da-vm" -ExposeVirtualizationExtensions $true
> ```

---

## 1- Provisionando o Cluster

O script de provisionamento instala o k3s no nó servidor e junta os nós agentes ao cluster.

> **Obs**: Como é um ambiente de laboratório, defini o token do k3s no Vagrantfile para facilitar a reprodutibilidade.

```bash
# Iniciar a criação do cluster com o comando:
vagrant up  

vagrant status 
# retorno
control-plane             running (libvirt)
worker-1                  running (libvirt)
worker-2                  running (libvirt)

# Acessar o Control Plane para verificar o status do cluster:
vagrant ssh control-plane

kubectl get nodes
```

**Saída esperada:**
```
# retorno
NAME            STATUS   ROLES           AGE     VERSION
control-plane   Ready    control-plane   3m56s   v1.34.6+k3s1
worker-1        Ready    <none>          3m51s   v1.34.6+k3s1
worker-2        Ready    <none>          3m51s   v1.34.6+k3s1
```

---

## 2- Service Mesh com Istio

No Control Plane, exporte o Kubeconfig para permitir o uso do kubectl e istioctl:

```bash
# Declara uma variável de ambiente para o kubeconfig do k3s
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
echo "export KUBECONFIG=/etc/rancher/k3s/k3s.yaml" >> ~/.bashrc

# Baixa a versão mais recente do Istio
curl -L https://istio.io/downloadIstio | sh -

# Move o binário para uma pasta do sistema
sudo mv istio-*/bin/istioctl /usr/local/bin/

# Instala o Istio no cluster
istioctl install --set profile=default -y

# Verificar se os pods do Istio estão rodando
kubectl get pods -n istio-system
```

**Saída esperada:**
```
NAME                                    READY   STATUS    RESTARTS   AGE
istio-ingressgateway-85c8f4b645-69mkr   1/1     Running   0          16m
istiod-6d584f88d4-2qbmz                 1/1     Running   0          16m
```

### Instalar o Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-4 | bash
```

---

## 3- Criar os Namespaces e ativar a Injeção Automática

```bash
# Cria os namespaces
kubectl apply -f namespaces/namespaces.yaml

# Verifica os namespaces criados
kubectl get namespaces
```

**Saída esperada:**
```
NAME              STATUS   AGE
service-1         Active   17s
service-2         Active   13s
service-3         Active   9s
```

---

## 4- Configurar Política de mTLS em modo STRICT

```bash
kubectl apply -f politicas/peer-authentication.yaml

kubectl get peerauthentication -A
```

**Saída esperada:**
```
NAMESPACE   NAME               MODE     AGE
service-1   strict-service-1   STRICT   83s
service-2   strict-service-2   STRICT   83s
service-3   strict-service-3   STRICT   83s
```

---

## 5- Subir os Serviços

### Aplicação 1 e 3 via YAML

```bash
kubectl apply -f deploy/deploy-yaml.yaml

kubectl get deploy -A
```

**Saída esperada:**
```
NAMESPACE      NAME                     READY   UP-TO-DATE   AVAILABLE   AGE
service-1      service-1                1/1     1            1           35s
service-3      service-3                1/1     1            1           35s

kubectl get svc -A
NAMESPACE      NAME                          TYPE           CLUSTER-IP      EXTERNAL-IP   PORT(S)
service-1      service-1                     ClusterIP      10.43.176.220   <none>        80/TCP  
service-3      service-3                     ClusterIP      10.43.219.201   <none>        80/TCP
```

### Aplicação 2 via Helm

```bash
# Criar o chart do Helm
helm create service-2

# Apagar os arquivos:
rm -f ./service-2/templates/httproute.yaml
rm -f ./service-2/templates/NOTES.txt

# Substituir o values.yaml pelo deploy-helm.yaml
cp ./deploy/deploy-helm.yaml ./service-2/values.yaml

# Instalar no cluster
helm install service-2 ./service-2 -n service-2

kubectl get svc -n service-2
```

**Saída esperada:**
```
NAME        TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
service-2   ClusterIP   10.43.140.17   <none>        80/TCP    30s
```

> **Obs:**: Precisei apagar o arquivo `httproute.yaml` e o `NOTES.txt` em `./service-2/templates` usado pelo novo recurso Gateway API do Kubernetes, pois estava causando um erro de validação na instalação do serviço.

---

## 6- Regras de Roteamento

### Gateway Externo

```bash
kubectl apply -f routing/gateway-externo.yaml
kubectl get gw -n istio-system
```

**Saída esperada:**
```
NAME             AGE
public-gateway   3h15m
```

### Virtual Services

```bash
kubectl apply -f routing/virtual-service-externo.yaml
kubectl apply -f routing/virtual-service-internal.yaml

kubectl get virtualservice -A
```

**Saída esperada:**
```
NAMESPACE      NAME             GATEWAYS             HOSTS                                       AGE
istio-system   public-routing   ["public-gateway"]   ["*"]                                       4m27s
service-1      route-to-svc2                         ["service-2.service-2.svc.cluster.local"]   15s

kubectl get destinationrule -A
NAMESPACE   NAME         HOST                                    AGE
service-1   dr-to-svc2   service-2.service-2.svc.cluster.local   29s
```

---

## 7- Políticas de Segurança e Autenticação JWT

Garantir que o Service 2 e 3 sejam protegidos e que o tráfego externo exija Token JWT para acessar os serviços.

### Validação de JWT para serviço 1 e 3

```bash
kubectl apply -f seguranca/request-auth.yaml
kubectl get requestauthentication -A
```

**Saída esperada:**
```
NAMESPACE   NAME            AGE
service-1   jwt-auth-svc1   16s
service-3   jwt-auth-svc3   16s
```

### Políticas de autorização

```bash
kubectl apply -f seguranca/authorization-policy.yml 
kubectl get authorizationpolicy -A
```

**Saída esperada:**
```
NAMESPACE   NAME                   ACTION   AGE
service-1   require-jwt-svc1       ALLOW    4m13s
service-2   allow-only-from-svc1   ALLOW    9s
service-3   deny-internal-access   ALLOW    9s
```

---

## 8- Validação

### Verificar NodePort do Gateway

```bash
kubectl get svc istio-ingressgateway -n istio-system
```

**Saída esperada:**
```
NAME                   TYPE           CLUSTER-IP    EXTERNAL-IP   PORT(S)                                      AGE
istio-ingressgateway   LoadBalancer   10.43.3.128   <pending>     15021:31499/TCP,80:30554/TCP,443:31832/TCP   67m
```

### Definir token válido

```bash
TOKEN=$(curl -s https://raw.githubusercontent.com/istio/istio/release-1.21/security/tools/jwt/samples/demo.jwt)
```

### Cenário 1: Acesso negado (Sem Token)

```bash
curl -I http://192.168.121.10:30554/svc1
```

**Resultado:**
```
HTTP/1.1 403 Forbidden
```

### Cenário 2: Acesso negado (Token Inválido)

```bash
curl -I -H "Authorization: Bearer token_falso" http://192.168.121.10:30554/svc1
```

**Resultado:**
```
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer realm="http://192.168.121.10:30554/svc1", error="invalid_token"
```

### Cenário 3: Acesso Liberado ao Service 1 e 3 (Com Token)

```bash
curl -H "Authorization: Bearer $TOKEN" http://192.168.121.10:30554/svc1
curl -H "Authorization: Bearer $TOKEN" http://192.168.121.10:30554/svc3
```

### Cenário 4: Testando o bloqueio do Service 2 (A partir do Service 3)

```bash
kubectl exec deploy/service-3 -n service-3 -- wget -q -S -O /dev/null http://service-2.service-2.svc.cluster.local
```

**Resultado:**
```
  HTTP/1.1 403 Forbidden
wget: server returned error: HTTP/1.1 403 Forbidden
```

### Cenário 5: Testando o isolamento do Service 3 (A partir do Service 1)

```bash
kubectl exec deploy/service-1 -n service-1 -- wget -q -S -O /dev/null http://service-3.service-3.svc.cluster.local
```

**Resultado:**
```
  HTTP/1.1 403 Forbidden
wget: server returned error: HTTP/1.1 403 Forbidden
```

---

## 9-  Autoscaling com KEDA e Prometheus

### Instalar o Prometheus na namespace do Istio

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install prometheus prometheus-community/prometheus -n istio-system -f prom-scrape.yaml
```

---

**Saída esperada:**
```
kubectl get pods -n istio-system
NAME                                                 READY   STATUS    RESTARTS   AGE
istio-ingressgateway-85c8f4b645-l4vjt                1/1     Running   0          24h
istiod-6d584f88d4-z9tln                              1/1     Running   0          24h
prometheus-alertmanager-0                            1/1     Running   0          49s
prometheus-kube-state-metrics-7c8c787854-4s958       1/1     Running   0          49s
prometheus-prometheus-node-exporter-2k2z8            1/1     Running   0          49s
prometheus-prometheus-node-exporter-7vdvb            1/1     Running   0          49s
prometheus-prometheus-node-exporter-sbwmx            1/1     Running   0          49s
prometheus-prometheus-pushgateway-68757884b8-6669l   1/1     Running   0          49s
prometheus-server-866565dc6-whmfq                    1/2     Running   0          49s
```
---

### Instalar o KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace
```

---

**Saída esperada:**
```
kubectl get pods -n keda
NAME                                                 READY   STATUS    RESTARTS   AGE
keda-admission-webhooks-7d5d987497-xwh6k           1/1     Running   1 (33s ago)   48s
keda-operator-658786f579-z46l5                     1/1     Running   1 (40s ago)   48s
keda-operator-metrics-apiserver-7b6fccf947-f4bz2   1/1     Running   1 (29s ago)   48s
```

---

### Instalar o k6

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf install -y https://dl.k6.io/rpm/repo.rpm
sudo dnf install -y k6
```

---

**Saída esperada:**
```
k6 version
k6 v1.7.1 (commit/9f82e6f1fc, go1.26.1, linux/amd64)
```

---

### Criar o ScaledObject para o Service 1

Monitorar a métrica istio_requests_total no Prometheus. Se o service-1 passar de 10 requisições por segundo, crie mais Pods até o limite de 5.

```bash
kubectl apply -f autoscaling/scaledobject.yaml
```

**Saída esperada:**
```
kubectl get scaledobject -n service-1
NAME                   SCALETARGETKIND      SCALETARGETNAME   MIN   MAX   READY   ACTIVE   FALLBACK   PAUSED   TRIGGERS     AUTHENTICATIONS   AGE
service-1-autoscaler   apps/v1.Deployment   service-1         1     5     True    False    False      False    prometheus                     111s
```
---

### Validação do Autoscaling

No terminal execute o comando para observar a criação dos Pods do Service 1:

```bash
kubectl get pods -n service-1 -w
```

**Saída esperada:**
```
kubectl get pods -n service-1 -w
NAME                        READY   STATUS    RESTARTS   AGE
service-1-9dc6747b5-7mphr   2/2     Running   0          141m
```

Em outro terminal executar o K6 passando a variável do Token e o arquivo de teste de carga:

```bash
k6 run -e TOKEN=$TOKEN loadtest.js
```

**Saída esperada alguns segundos após a inicialização do teste:**
```
kubectl get pods -n service-1 -w
NAME                        READY   STATUS    RESTARTS   AGE
service-1-9dc6747b5-7mphr   2/2     Running   0          175m
service-1-9dc6747b5-9b2bb   2/2     Running   0          9s
service-1-9dc6747b5-f96fj   2/2     Running   0          38s
service-1-9dc6747b5-hxdww   2/2     Running   0          38s
service-1-9dc6747b5-xhm8g   2/2     Running   0          38s
```

**Saída esperada do HPA:**
```
kubectl get hpa -n service-1 -w
NAME                            REFERENCE              TARGETS           MINPODS   MAXPODS   REPLICAS   AGE
keda-hpa-service-1-autoscaler   Deployment/service-1   0/10 (avg)        1         5         1          38m
keda-hpa-service-1-autoscaler   Deployment/service-1   34500m/10 (avg)   1         5         1          39m
keda-hpa-service-1-autoscaler   Deployment/service-1   8625m/10 (avg)    1         5         4          39m
```

**Resultado do teste k6:**
```
  █ TOTAL RESULTS 

    HTTP
    http_req_duration..............: avg=4.16ms   min=1.28ms   med=3.77ms   max=165.05ms p(90)=5.33ms   p(95)=6.26ms  
      { expected_response:true }...: avg=4.16ms   min=1.28ms   med=3.77ms   max=165.05ms p(90)=5.33ms   p(95)=6.26ms  
    http_req_failed................: 0.00% 0 out of 34387
    http_reqs......................: 34387 286.394105/s

    EXECUTION
    iteration_duration.............: avg=104.72ms min=101.45ms med=104.34ms max=266.05ms p(90)=105.98ms p(95)=106.93ms
    iterations.....................: 34387 286.394105/s
    vus............................: 30    min=30         max=30
    vus_max........................: 30    min=30         max=30

    NETWORK
    data_received..................: 59 MB 495 kB/s
    data_sent......................: 24 MB 201 kB/s

running (2m00.1s), 00/30 VUs, 34387 complete and 0 interrupted iterations
default ✓ [======================================] 30 VUs  2m0s
```

---

## 📁 Estrutura do Projeto

```
desafio-devops/
├── README.md
├── Vagrantfile
├── deploy/
│   ├── deploy-helm.yaml
│   └── deploy-yaml.yaml
├── namespaces/
│   └── namespaces.yaml
├── politicas/
│   └── peer-authentication.yaml
├── routing/
│   ├── gateway-externo.yaml
│   ├── virtual-service-externo.yaml
│   └── virtual-service-internal.yaml
├── seguranca/
│   ├── authorization-policy.yml
│   └── request-auth.yaml
└── autoscaling/
    └── scaledobject.yaml
```

---
