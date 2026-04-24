Vagrant.configure("2") do |config|
  config.vm.box = "generic/oracle9" # Imagem leve do Oracle Linux 9
  
  # Definindo um token para o cluster
  TOKEN = "123"

  # Instalação do Control Plane
  $control_plane = <<-SCRIPT
    systemctl disable firewalld --now
    export K3S_TOKEN="#{TOKEN}"
    export INSTALL_K3S_SKIP_START=true # não inicia automaticamente o k3s após a instalação
    curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
    systemctl start k3s --no-block # Inicia em background liberando o terminal
  SCRIPT

  # Instalação dos Workers
  $worker = <<-SCRIPT
    systemctl disable firewalld --now
    export K3S_TOKEN="#{TOKEN}"
    export K3S_URL="https://192.168.121.10:6443"
    export INSTALL_K3S_SKIP_START=true
    curl -sfL https://get.k3s.io | sh -
    systemctl start k3s-agent --no-block
  SCRIPT

  # Configuração do Server
  config.vm.define "control-plane" do |server| # 
    server.vm.hostname = "control-plane" 
    server.vm.network "private_network", ip: "192.168.121.10"
    server.vm.provider :libvirt do |v|
      v.memory = 4096
      v.cpus = 2
    end
    server.vm.provision "shell", inline: $control_plane
  end

  # Configuração dos workers
  (1..2).each do |i|
    config.vm.define "worker-#{i}" do |agent|
      agent.vm.hostname = "worker-#{i}"
      agent.vm.network "private_network", ip: "192.168.121.#{10+i}"
      agent.vm.provider :libvirt do |v|
        v.memory = 3072
        v.cpus = 2
      end
      agent.vm.provision "shell", inline: $worker
    end
  end
end
