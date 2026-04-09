const toggleTheme = () => {
  const currentTheme = localStorage.getItem('theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';

  // Armazena a preferencia do tema no navegador
  localStorage.setItem('theme', newTheme);

  // Aplica a classe de tema no corpo
  document.body.classList.toggle('dark', newTheme === 'dark');
};

// Detecta a preferencia do sistema operacional
const detectSystemTheme = () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const savedTheme = localStorage.getItem('theme');

  // Se nao houver tema salvo, usa a preferencia do sistema
  if (!savedTheme) {
    document.body.classList.toggle('dark', prefersDark);
  }
};

// Chama a funcao para detectar e aplicar o tema preferido
detectSystemTheme();

// Event listener para o botao de alternar tema
const toggleThemeButton = document.getElementById('toggleThemeBtn');
if (toggleThemeButton) {
  toggleThemeButton.addEventListener('click', toggleTheme);
}

