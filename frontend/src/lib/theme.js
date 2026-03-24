
const toggleTheme = () => {
  const currentTheme = localStorage.getItem('theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  // Armazenar a preferência do tema no navegador
  localStorage.setItem('theme', newTheme);
  
  // Aplicar a classe de tema no corpo
  document.body.classList.toggle('dark', newTheme === 'dark');
};

// Detectar a preferência do sistema operacional
const detectSystemTheme = () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const savedTheme = localStorage.getItem('theme');

  // Se o tema não foi salvo, aplicar o tema preferido do sistema
    document.body.classList.toggle('dark', prefersDark);
  }
};

// Chama a função para detectar e aplicar o tema preferido
detectSystemTheme();

// Event listener para o botão de alternar tema
document.getElementById('toggleThemeBtn').addEventListener('click', toggleTheme);

