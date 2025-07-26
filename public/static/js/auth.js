import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Firebase configuration (remains the same)
const firebaseConfig = {
  apiKey: "AIzaSyADK24bSdgcMCopeF-BJaZucHyIWo_F2kc",
  authDomain: "digital-twin-7de56.firebaseapp.com",
  projectId: "digital-twin-7de56",
  storageBucket: "digital-twin-7de56.firebasestorage.app",
  messagingSenderId: "150254210836",
  appId: "1:150254210836:web:a3ef3ec39dc71b7cd4bc01"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentProject = null;

onAuthStateChanged(auth, (user) => {
  const logoutBtn = document.getElementById('logoutBtn');
  if (user) {
    currentUser = user;
    hideAuthModal();
    showProjectsModal();
    showNotification(`Welcome back, ${user.email}`, 'success');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    currentUser = null;
    currentProject = null;
    showAuthModal();
    if (typeof window.updateProjectDisplay === 'function') {
        window.updateProjectDisplay(null);
    }
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
});

// Show authentication modal
function showAuthModal() {
  // Remove existing modal if any
  const existingModal = document.getElementById('auth-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-container">
      <div class="auth-header">
        <img src="./static/img/Holcim Logo.png" alt="Holcim Logo" class="auth-logo">
        <h1>Holcim Digital Twin Builder</h1>
        <p>Create and manage your digital twin projects</p>
      </div>
      


      
      <!-- Login Form -->
      <div id="login-form" class="auth-form active">
        <h3>Sign In to Your Account</h3>
        <form id="login-form-element">
          <div class="form-group">
            <label for="login-email">Email Address</label>
            <input type="email" id="login-email" required placeholder="Enter your email">
          </div>
          <div class="form-group">
            <label for="login-password">Password</label>
            <input type="password" id="login-password" required placeholder="Enter your password">
          </div>
          <button type="submit" class="auth-btn primary">
            <i class="fa-solid fa-sign-in-alt"></i> Sign In
          </button>
          <p class="auth-link">
            <a href="#" id="forgot-password-link">Forgot your password?</a>
          </p>
        </form>
        <div id="login-error" class="error-message"></div>
      </div>
      
      
      <!-- Reset Password Form -->
      <div id="reset-form" class="auth-form">
        <h3>Reset Your Password</h3>
        <p class="reset-description">Enter your email address and we'll send you a link to reset your password.</p>
        <form id="reset-form-element">
          <div class="form-group">
            <label for="reset-email">Email Address</label>
            <input type="email" id="reset-email" required placeholder="Enter your email">
          </div>
          <button type="submit" class="auth-btn primary">
            <i class="fa-solid fa-paper-plane"></i> Send Reset Email
          </button>
          <p class="auth-link">
            <a href="#" id="back-to-login">Back to Sign In</a>
          </p>
        </form>
        <div id="reset-error" class="error-message"></div>
        <div id="reset-success" class="success-message"></div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  setupAuthEventListeners();
}

// Hide authentication modal
function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.remove();
  }
}

// Setup event listeners for auth forms
function setupAuthEventListeners() {
  // Tab switching
  const tabs = document.querySelectorAll('.auth-tab');
  const forms = document.querySelectorAll('.auth-form');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabType = tab.getAttribute('data-tab');
      
      // Remove active class from all tabs and forms
      tabs.forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding form
      tab.classList.add('active');
      document.getElementById(`${tabType}-form`).classList.add('active');
      
      // Clear error messages
      document.getElementById('login-error').textContent = '';
      if (document.getElementById('reset-error')) {
        document.getElementById('reset-error').textContent = '';
        document.getElementById('reset-success').textContent = '';
      }
    });
  });
  
  // Login form submission
  document.getElementById('login-form-element').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorElement = document.getElementById('login-error');
    
    try {
      errorElement.textContent = '';
      await signInWithEmailAndPassword(auth, email, password);
      // Success notification will be handled by auth state change
    } catch (error) {
      console.error('Login error:', error);
      // Use notification system instead of hidden error message
      showNotification(getAuthErrorMessage(error.code), 'error');
    }
  });
  

  
  // Reset password form submission
  document.getElementById('reset-form-element')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('reset-email');
    const errorElement = document.getElementById('reset-error');
    const successElement = document.getElementById('reset-success');

    try {
      if (errorElement) errorElement.textContent = '';
      if (successElement) successElement.textContent = '';

      await sendPasswordResetEmail(auth, emailInput?.value);

      showNotification('Password reset email sent! Check your inbox and spam folder.', 'success');
      if (emailInput) emailInput.value = '';
    } catch (error) {
      console.error('Reset password error:', error);
      showNotification(getAuthErrorMessage(error.code), 'error');
    }
  });

  
  // Forgot password link
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Switch to reset password tab
      const resetTab = document.querySelector('.auth-tab[data-tab="reset"]');
      const loginTab = document.querySelector('.auth-tab[data-tab="login"]');
      const forms = document.querySelectorAll('.auth-form');
      
      // Remove active from all tabs and forms
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));
      
      // Activate reset tab and form
      resetTab.classList.add('active');
      document.getElementById('reset-form').classList.add('active');
      
      // Pre-fill email if available
      const loginEmail = document.getElementById('login-email').value;
      if (loginEmail) {
        document.getElementById('reset-email').value = loginEmail;
      }
    });
  }
  
  // Back to login link
  const backToLoginLink = document.getElementById('back-to-login');
  if (backToLoginLink) {
    backToLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Switch back to login tab
      const loginTab = document.querySelector('.auth-tab[data-tab="login"]');
      const resetTab = document.querySelector('.auth-tab[data-tab="reset"]');
      const forms = document.querySelectorAll('.auth-form');
      
      // Remove active from all tabs and forms
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      forms.forEach(f => f.classList.remove('active'));
      
      // Activate login tab and form
      loginTab.classList.add('active');
      document.getElementById('login-form').classList.add('active');
    });
  }
}

// Get user-friendly error messages
function getAuthErrorMessage(errorCode) {
  switch (errorCode) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists';
    case 'auth/weak-password':
      return 'Password is too weak. Please choose a stronger password';
    case 'auth/user-not-found':
      return 'No account found with this email address';
    case 'auth/wrong-password':
      return 'Incorrect password';
    case 'auth/invalid-email':
      return 'Invalid email address';
    case 'auth/user-disabled':
      return 'This account has been disabled';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later';
    case 'auth/invalid-credential':
      return 'Invalid email or password';
    case 'auth/missing-email':
      return 'Please enter an email address';
    default:
      return 'An error occurred. Please try again';
  }
}

// Logout function
async function logoutUser() {
  // Add confirmation for unsaved changes before logging out
  if (window.hasUnsavedChanges()) {
    window.showSaveConfirmationDialog(
      'logging out',
      () => { // onSave
        saveProject().then(() => signOut(auth));
      },
      () => { // onDontSave
        signOut(auth);
      }
    );
  } else {
    await signOut(auth);
    showNotification('Successfully signed out', 'success');
  }
}

// Show projects modal
function showProjectsModal() {
  // Check if user is authenticated
  if (!currentUser) {
    showAuthModal();
    return;
  }

  // Remove existing modal if any
  const existingModal = document.getElementById('projects-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'projects-modal';
  modal.className = 'projects-modal';
  modal.innerHTML = `
    <div class="projects-container">
      <div class="projects-header">
        <div class="user-info">
          <i class="fa-solid fa-user-circle"></i>
          <span>${currentUser.email}</span>
          <button id="logout-btn" class="logout-btn" title="Sign Out">
            <i class="fa-solid fa-sign-out-alt"></i>
          </button>
        </div>
        <h2>Your Digital Twin Projects</h2>
        <p>Select an existing project or create a new one</p>
      </div>
      
      <div class="projects-actions">
        <button id="new-project-btn" class="project-btn primary">
          <i class="fa-solid fa-plus"></i> Create New Project
        </button>
      </div>
      
      <div id="projects-list" class="projects-list">
        <div class="loading">
          <i class="fa-solid fa-spinner fa-spin"></i> Loading projects...
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  setupProjectsEventListeners();
  loadUserProjects();
}

// Hide projects modal
function hideProjectsModal() {
  const modal = document.getElementById('projects-modal');
  if (modal) {
    modal.remove();
  }
}

// Setup event listeners for projects modal
function setupProjectsEventListeners() {
  // Logout button
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await signOut(auth);
      hideProjectsModal();
    } catch (error) {
      console.error('Logout error:', error);
    }
  });
  
  // New project button
  document.getElementById('new-project-btn').addEventListener('click', () => {
    showCreateProjectModal();
  });
}

// Load user projects from Firestore
async function loadUserProjects() {
  const projectsList = document.getElementById('projects-list');
  
  try {
    const q = query(collection(db, 'projects'), where('userId', '==', currentUser.uid));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      projectsList.innerHTML = `
        <div class="no-projects">
          <i class="fa-solid fa-folder-open"></i>
          <h3>No Projects Yet</h3>
          <p>Create your first digital twin project to get started</p>
        </div>
      `;
      return;
    }
    
    const projects = [];
    querySnapshot.forEach((doc) => {
      projects.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort projects by last modified
    projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    
    projectsList.innerHTML = projects.map(project => `
      <div class="project-card" data-project-id="${project.id}">
        <div class="project-info">
          <h4>${project.name}</h4>
          <p>${project.description || 'No description'}</p>
          <div class="project-meta">
            <span><i class="fa-solid fa-calendar"></i> ${new Date(project.lastModified).toLocaleDateString()}</span>
            <span><i class="fa-solid fa-cubes"></i> ${project.modelCount || 0} models</span>
          </div>
        </div>
        <div class="project-actions">
          <button class="project-action-btn primary" onclick="openProject('${project.id}')">
            <i class="fa-solid fa-folder-open"></i> Open
          </button>
          <button class="project-action-btn danger" onclick="deleteProject('${project.id}', '${project.name}')">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading projects:', error);
    projectsList.innerHTML = `
      <div class="error">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <h3>Error Loading Projects</h3>
        <p>Please try refreshing the page</p>
      </div>
    `;
  }
}

// Show create project modal
function showCreateProjectModal() {
  const existingModal = document.getElementById('create-project-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'create-project-modal';
  modal.className = 'create-project-modal';
  modal.innerHTML = `
    <div class="create-project-container">
      <div class="create-project-header">
        <h3>Create New Project</h3>
        <button class="close-btn" onclick="hideCreateProjectModal()">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      
      <form id="create-project-form">
        <div class="form-group">
          <label for="project-name">Project Name *</label>
          <input type="text" id="project-name" required placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="project-description">Description</label>
          <textarea id="project-description" placeholder="Enter project description (optional)" rows="3"></textarea>
        </div>
        
        <div class="form-actions">
          <button type="button" class="cancel-btn" onclick="hideCreateProjectModal()">Cancel</button>
          <button type="submit" class="create-btn">
            <i class="fa-solid fa-plus"></i> Create Project
          </button>
        </div>
      </form>
      
      <div id="create-project-error" class="error-message" style="display: none;"></div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Setup form submission
  document.getElementById('create-project-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('project-name').value.trim();
        const description = document.getElementById('project-description').value.trim();
        const errorElement = document.getElementById('create-project-error');
    
    if (!name) {
      errorElement.textContent = 'Project name is required';
      errorElement.style.display = 'block';
      return;
    }
    
    try {
      errorElement.textContent = '';
      errorElement.style.display = 'none';
      
      // Check if project name already exists for this user
      const projectsQuery = query(collection(db, 'projects'), 
        where('userId', '==', currentUser.uid),
        where('name', '==', name));
      const existingProjects = await getDocs(projectsQuery);
      
      if (!existingProjects.empty) {
        errorElement.textContent = 'A project with this name already exists. Please choose a different name.';
        errorElement.style.display = 'block';
        showNotification('Project name already exists', 'error');
        return;
      }
      
      const projectData = {
        name: name,
        description: description,
        userId: currentUser.uid,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        modelCount: 0,
        sceneData: {
          models: [],
          camera: {},
          settings: {}
        }
      };
      
      const docRef = await addDoc(collection(db, 'projects'), projectData);
      console.log('Project created with ID:', docRef.id);
      
      hideCreateProjectModal();
      currentProject = { id: docRef.id, ...projectData };
      hideProjectsModal();
      
      // Update project name display
      if (typeof window.updateProjectDisplay === 'function') {
        window.updateProjectDisplay(currentProject.name);
      }
      
      clearSceneSilently();
      loadLastSceneFromCache(); 
      // Show success notification
      showNotification(`Project "${name}" created successfully!`, 'success');
      
      // Mark scene as saved since we just created a new project
      if (typeof window.markSceneAsSaved === 'function') {
        window.markSceneAsSaved();
      }
      
    } catch (error) {
      console.error('Error creating project:', error);
      errorElement.textContent = 'Error creating project. Please try again.';
      errorElement.style.display = 'block';
    }
  });
  
  // Focus on project name input
  setTimeout(() => {
    document.getElementById('project-name').focus();
  }, 100);
}

// Hide create project modal
function hideCreateProjectModal() {
  const modal = document.getElementById('create-project-modal');
  if (modal) {
    modal.remove();
  }
}

// Open existing project
async function openProject(projectId) {
  if (window.hasUnsavedChanges()) {
    window.showSaveConfirmationDialog(
      'opening a new project',
      () => { // onSave
        saveProject().then(() => proceedToOpen(projectId));
      },
      () => { // onDontSave
        proceedToOpen(projectId);
      }
    );
  } else {
    proceedToOpen(projectId);
  }
}

async function proceedToOpen(projectId) {
  try {
    const projectDoc = await getDocs(query(collection(db, 'projects'), where('userId', '==', currentUser.uid)));
    const project = projectDoc.docs.find(doc => doc.id === projectId);
    
    if (project) {
      currentProject = { id: project.id, ...project.data() };
      hideProjectsModal();
      
      if (typeof window.updateProjectDisplay === 'function') {
        window.updateProjectDisplay(currentProject.name);
      }

      if (currentProject.sceneData) {
        loadProjectScene(currentProject.sceneData);
      }

      showNotification(`Project "${currentProject.name}" opened!`, 'success');
    }
  } catch (error) {
    console.error('Error opening project:', error);
    showNotification('Error opening project', 'error');
  }
}



// Delete project
async function deleteProject(projectId, projectName) {
  const existingModal = document.getElementById('delete-project-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-project-modal';
  modal.className = 'delete-project-modal';
  modal.innerHTML = `
    <div class="delete-project-container">
      <div class="delete-project-header">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <h3>Delete Project</h3>
      </div>
      
      <p>Are you sure you want to delete <strong>"${projectName}"</strong>?</p>
      <p class="warning-text">This action cannot be undone.</p>
      
      <div class="form-actions">
        <button type="button" class="cancel-btn" onclick="hideDeleteProjectModal()">Cancel</button>
        <button type="button" class="delete-btn" onclick="confirmDeleteProject('${projectId}')">
          <i class="fa-solid fa-trash"></i> Delete Project
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

// Hide delete project modal
function hideDeleteProjectModal() {
  const modal = document.getElementById('delete-project-modal');
  if (modal) {
    modal.remove();
  }
}

// Confirm project deletion
async function confirmDeleteProject(projectId) {
  try {
    await deleteDoc(doc(db, 'projects', projectId));
    hideDeleteProjectModal();
    loadUserProjects(); // Refresh the projects list
    showNotification('Project deleted successfully', 'success');
  } catch (error) {
    console.error('Error deleting project:', error);
    showNotification('Error deleting project', 'error');
  }
}

// Save current scene to project - enhanced for auto-save support
async function saveProject(silentMode = false) {
  if (!currentUser) {
    if (!silentMode) showNotification('Please sign in to save your project', 'error');
    return Promise.reject(new Error('Not authenticated'));
  }

  if (!currentProject) {
    if (!silentMode) {
      showSaveAsModal();
    }
    return Promise.reject(new Error('No current project'));
  }

  try {
    const sceneData = getCurrentSceneData();
    await updateDoc(doc(db, 'projects', currentProject.id), {
      sceneData: sceneData,
      lastModified: new Date().toISOString(),
      modelCount: sceneData.models.length
    });

    if (!silentMode) {
      showNotification(`Project "${currentProject.name}" saved!`, 'success');
    }

    if (typeof window.markSceneAsSaved === 'function') {
      window.markSceneAsSaved();
    }

    return Promise.resolve();
  } catch (error) {
    if (!silentMode) showNotification('Error saving project', 'error');
    return Promise.reject(error);
  }
}


// Enhanced save function with silent mode for auto-save
async function saveProjectToFirebase(silentMode = false) {
  if (!currentUser) {
    if (!silentMode) showNotification('Please sign in to save your project', 'error');
    return Promise.reject(new Error('Not authenticated'));
  }
  
  if (!currentProject) {
    // No current project, show save as dialog only in manual mode
    if (!silentMode) {
    showSaveAsModal();
    }
    return Promise.reject(new Error('No current project'));
  }
  
  try {
    const sceneData = getCurrentSceneData();
    
    await updateDoc(doc(db, 'projects', currentProject.id), {
      sceneData: sceneData,
      lastModified: new Date().toISOString(),
      modelCount: sceneData.models.length
    });
    
    currentProject.sceneData = sceneData;
    currentProject.lastModified = new Date().toISOString();
    currentProject.modelCount = sceneData.models.length;
    
    // Only show notification in manual mode
    if (!silentMode) {
    showNotification(`Project "${currentProject.name}" saved!`, 'success');
    }
    
    // Mark scene as saved
    if (typeof window.markSceneAsSaved === 'function') {
      window.markSceneAsSaved();
    }
    
    return Promise.resolve();
  } catch (error) {
    console.error('Error saving project:', error);
    if (!silentMode) {
    showNotification('Error saving project', 'error');
    }
    return Promise.reject(error);
  }
}

// Show save as modal
function showSaveAsModal() {
  const existingModal = document.getElementById('save-as-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'save-as-modal';
  modal.className = 'save-as-modal';
  modal.innerHTML = `
    <div class="save-as-container">
      <div class="save-as-header">
        <h3>Save Project As</h3>
        <button class="close-btn" onclick="hideSaveAsModal()">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
      
      <form id="save-as-form">
        <div class="form-group">
          <label for="save-project-name">Project Name *</label>
          <input type="text" id="save-project-name" required placeholder="Enter project name">
        </div>
        
        <div class="form-group">
          <label for="save-project-description">Description</label>
          <textarea id="save-project-description" placeholder="Enter project description (optional)" rows="3"></textarea>
        </div>
        
        <div class="form-actions">
          <button type="button" class="cancel-btn" onclick="hideSaveAsModal()">Cancel</button>
          <button type="submit" class="save-btn">
            <i class="fa-solid fa-save"></i> Save Project
          </button>
        </div>
      </form>
      
      <div id="save-as-error" class="error-message" style="display: none;"></div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Setup form submission
  document.getElementById('save-as-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('save-project-name').value.trim();
    const description = document.getElementById('save-project-description').value.trim();
    const errorElement = document.getElementById('save-as-error');
    
    if (!name) {
      errorElement.textContent = 'Project name is required';
      errorElement.style.display = 'block';
      return;
    }
    
    try {
      errorElement.textContent = '';
      errorElement.style.display = 'none';
      
      // Check if project name already exists for this user
      const projectsQuery = query(collection(db, 'projects'), 
        where('userId', '==', currentUser.uid),
        where('name', '==', name));
      const existingProjects = await getDocs(projectsQuery);
      
      if (!existingProjects.empty) {
        errorElement.textContent = 'A project with this name already exists. Please choose a different name.';
        errorElement.style.display = 'block';
        showNotification('Project name already exists', 'error');
        return;
      }
      
      const sceneData = getCurrentSceneData();
      
      const projectData = {
        name: name,
        description: description,
        userId: currentUser.uid,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        modelCount: sceneData.models.length,
        sceneData: sceneData
      };
      
      const docRef = await addDoc(collection(db, 'projects'), projectData);
      console.log('Project saved with ID:', docRef.id);
      
      currentProject = { id: docRef.id, ...projectData };
      hideSaveAsModal();
      
      // Update project name display
      if (typeof window.updateProjectDisplay === 'function') {
        window.updateProjectDisplay(currentProject.name);
      }
      
      showNotification(`Project "${name}" saved successfully!`, 'success');
      
      // Mark scene as saved since we just saved a new project
      if (typeof window.markSceneAsSaved === 'function') {
        window.markSceneAsSaved();
      }
      
    } catch (error) {
      console.error('Error saving project:', error);
      errorElement.textContent = 'Error saving project. Please try again.';
      errorElement.style.display = 'block';
    }
  });
  
  // Focus on project name input
  setTimeout(() => {
    document.getElementById('save-project-name').focus();
  }, 100);
}

// Hide save as modal
function hideSaveAsModal() {
  const modal = document.getElementById('save-as-modal');
  if (modal) {
    modal.remove();
  }
}

// Get current scene data for saving
function getCurrentSceneData() {
  const modelInstances = window.modelInstances || [];
  const currentCamera = window.currentCamera;
  const orbit = window.orbit;

  const models = modelInstances.map(instance => ({
    name: instance.name,
    position: instance.model.position.toArray(),
    rotation: instance.model.rotation.toArray(),
    scale: instance.model.scale.toArray ? instance.model.scale.toArray() : [1, 1, 1],
    uuid: instance.model.uuid
  }));

  const camera = currentCamera ? {
    position: currentCamera.position.toArray(),
    target: orbit ? orbit.target.toArray() : [0, 0, 0],
    type: currentCamera.isPerspectiveCamera ? 'perspective' : 'orthographic'
  } : {};

  const settings = {
    shadows: document.getElementById('showShadows')?.checked || false,
    ambientLight: parseFloat(document.getElementById('ambientLight')?.value || 0),
    directLight: parseFloat(document.getElementById('directLight')?.value || 2)
  };

  const undoStack = window.undoStack || [];
  const redoStack = window.redoStack || [];

  const serializeStack = (stack) => {
    return stack.map(action => {
      const serializedAction = JSON.parse(JSON.stringify(action));

      if (action.type === 'transform') {
        if (action.oldPosition) {
          serializedAction.oldPosition = {
            x: action.oldPosition.x,
            y: action.oldPosition.y,
            z: action.oldPosition.z,
            isVector3: true
          };
        }
        if (action.newPosition) {
          serializedAction.newPosition = {
            x: action.newPosition.x,
            y: action.newPosition.y,
            z: action.newPosition.z,
            isVector3: true
          };
        }
        if (action.oldRotation) {
          serializedAction.oldRotation = {
            x: action.oldRotation.x,
            y: action.oldRotation.y,
            z: action.oldRotation.z,
            isEuler: true
          };
        }
        if (action.newRotation) {
          serializedAction.newRotation = {
            x: action.newRotation.x,
            y: action.newRotation.y,
            z: action.newRotation.z,
            isEuler: true
          };
        }
        if (action.oldScale) {
          serializedAction.oldScale = {
            x: action.oldScale.x,
            y: action.oldScale.y,
            z: action.oldScale.z,
            isVector3: true
          };
        }
        if (action.newScale) {
          serializedAction.newScale = {
            x: action.newScale.x,
            y: action.newScale.y,
            z: action.newScale.z,
            isVector3: true
          };
        }
      }
      return serializedAction;
    });
  };

  return {
    models,
    camera,
    settings,
    lastSaved: new Date().toISOString(),
    undoStack: serializeStack(undoStack),
    redoStack: serializeStack(redoStack)
  };
}


// Load project scene data
function loadProjectScene(sceneData) {
  const clearScene = window.clearScene;
  const modelInstances = window.modelInstances;
  const controlsList = window.controlsList;
  const scene = window.scene;
  const updateSceneStats = window.updateSceneStats;
  const deselectAllModels = window.deselectAllModels;

  if (clearScene && typeof clearScene === 'function') {
    modelInstances.forEach(instance => {
      scene.remove(instance.model);
      scene.remove(instance.control);
    });
    modelInstances.length = 0;
    controlsList.length = 0;
    updateSceneStats();

    if (deselectAllModels && typeof deselectAllModels === 'function') {
      deselectAllModels();
    }
  }

  // Load models
  if (sceneData.models && sceneData.models.length > 0) {
    let modelsToLoad = sceneData.models.length;
    let modelsLoaded = 0;

    sceneData.models.forEach(modelData => {
      try {
        // Fix: Convert array formats back to THREE objects if needed
        if (Array.isArray(modelData.position)) {
          modelData.position = new THREE.Vector3(...modelData.position);
        }
        if (Array.isArray(modelData.rotation)) {
          modelData.rotation = new THREE.Euler(...modelData.rotation);
        }
        if (Array.isArray(modelData.scale)) {
          modelData.scale = new THREE.Vector3(...modelData.scale);
        }

        loadModelFromData(modelData, () => {
          modelsLoaded++;
          if (modelsLoaded >= modelsToLoad) {
            console.log("All models loaded, ensuring nothing is selected");
            setTimeout(() => {
              if (deselectAllModels && typeof deselectAllModels === 'function') {
                deselectAllModels();
              }
            }, 100);
          }
        });
      } catch (error) {
        console.error("Error loading model:", error);
        modelsLoaded++;
      }
    });
  }

  // Load camera
  if (sceneData.camera) {
    setTimeout(() => {
      const currentCamera = window.currentCamera;
      const orbit = window.orbit;
      const scheduleRender = window.scheduleRender;

      if (sceneData.camera.position && currentCamera) {
        const pos = Array.isArray(sceneData.camera.position)
          ? sceneData.camera.position
          : [sceneData.camera.position.x, sceneData.camera.position.y, sceneData.camera.position.z];
        currentCamera.position.set(...pos);
      }

      if (sceneData.camera.target && orbit) {
        const tgt = Array.isArray(sceneData.camera.target)
          ? sceneData.camera.target
          : [sceneData.camera.target.x, sceneData.camera.target.y, sceneData.camera.target.z];
        orbit.target.set(...tgt);
      }

      if (orbit) orbit.update();
      if (scheduleRender) scheduleRender();
    }, 500);
  }

  // Load settings
  if (sceneData.settings) {
    setTimeout(() => {
      const hemiLight = window.hemiLight;
      const dirLight = window.dirLight;
      const scheduleRender = window.scheduleRender;

      if (sceneData.settings.shadows !== undefined) {
        const shadowsCheckbox = document.getElementById('showShadows');
        if (shadowsCheckbox) shadowsCheckbox.checked = sceneData.settings.shadows;
      }

      if (sceneData.settings.ambientLight !== undefined) {
        const ambientSlider = document.getElementById('ambientLight');
        if (ambientSlider) {
          ambientSlider.value = sceneData.settings.ambientLight;
          if (hemiLight) hemiLight.intensity = sceneData.settings.ambientLight;
        }
      }

      if (sceneData.settings.directLight !== undefined) {
        const directSlider = document.getElementById('directLight');
        if (directSlider) {
          directSlider.value = sceneData.settings.directLight;
          if (dirLight) dirLight.intensity = sceneData.settings.directLight;
        }
      }

      if (scheduleRender) scheduleRender();
    }, 100);
  }

  // Restore undo stack
  if (sceneData.undoStack && Array.isArray(sceneData.undoStack)) {
    console.log("Restoring undo stack with", sceneData.undoStack.length, "items");

    const processedUndoStack = sceneData.undoStack.map(action => {
      const processedAction = JSON.parse(JSON.stringify(action));

      if (action.type === 'transform') {
        if (action.oldPosition) {
          processedAction.oldPosition = new THREE.Vector3(
            action.oldPosition.x, action.oldPosition.y, action.oldPosition.z
          );
        }
        if (action.newPosition) {
          processedAction.newPosition = new THREE.Vector3(
            action.newPosition.x, action.newPosition.y, action.newPosition.z
          );
        }
        if (action.oldRotation) {
          processedAction.oldRotation = new THREE.Euler(
            action.oldRotation.x, action.oldRotation.y, action.oldRotation.z
          );
        }
        if (action.newRotation) {
          processedAction.newRotation = new THREE.Euler(
            action.newRotation.x, action.newRotation.y, action.newRotation.z
          );
        }
        if (action.oldScale) {
          processedAction.oldScale = new THREE.Vector3(
            action.oldScale.x, action.oldScale.y, action.oldScale.z
          );
        }
        if (action.newScale) {
          processedAction.newScale = new THREE.Vector3(
            action.newScale.x, action.newScale.y, action.newScale.z
          );
        }
      }

      return processedAction;
    });

    window.undoStack = processedUndoStack;
  }

  // Restore redo stack
  if (sceneData.redoStack && Array.isArray(sceneData.redoStack)) {
    console.log("Restoring redo stack with", sceneData.redoStack.length, "items");

    const processedRedoStack = sceneData.redoStack.map(action => {
      const processedAction = JSON.parse(JSON.stringify(action));

      if (action.type === 'transform') {
        if (action.oldPosition) {
          processedAction.oldPosition = new THREE.Vector3(
            action.oldPosition.x, action.oldPosition.y, action.oldPosition.z
          );
        }
        if (action.newPosition) {
          processedAction.newPosition = new THREE.Vector3(
            action.newPosition.x, action.newPosition.y, action.newPosition.z
          );
        }
        if (action.oldRotation) {
          processedAction.oldRotation = new THREE.Euler(
            action.oldRotation.x, action.oldRotation.y, action.oldRotation.z
          );
        }
        if (action.newRotation) {
          processedAction.newRotation = new THREE.Euler(
            action.newRotation.x, action.newRotation.y, action.newRotation.z
          );
        }
        if (action.oldScale) {
          processedAction.oldScale = new THREE.Vector3(
            action.oldScale.x, action.oldScale.y, action.oldScale.z
          );
        }
        if (action.newScale) {
          processedAction.newScale = new THREE.Vector3(
            action.newScale.x, action.newScale.y, action.newScale.z
          );
        }
      }

      return processedAction;
    });

    window.redoStack = processedRedoStack;
  }

  // Final cleanup and saved mark
  setTimeout(() => {
    if (deselectAllModels && typeof deselectAllModels === 'function') {
      deselectAllModels();
    }
    if (typeof window.markSceneAsSaved === 'function') {
      window.markSceneAsSaved();
    }
  }, 1000);
}


// Load a single model from saved data
function loadModelFromData(modelData, callback) {
  const models = window.models || {};
  const importedModels = window.importedModels || {};
  const allModels = { ...models, ...importedModels };
  const baseName = modelData.name.replace(/ \d+$/, '');
  const modelConfig = allModels[baseName] || allModels[modelData.name];
  
  if (!modelConfig) {
    console.error('Model config not found for:', modelData.name);
    if (callback && typeof callback === 'function') callback();
    return;
  }
  
  const GLTFLoader = window.GLTFLoader;
  const scene = window.scene;
  const currentCamera = window.currentCamera;
  const renderer = window.renderer;
  const TransformControls = window.TransformControls;
  const orbit = window.orbit;
  const controlsList = window.controlsList;
  const modelInstances = window.modelInstances;
  const updateSceneStats = window.updateSceneStats;
  const scheduleRender = window.scheduleRender;
  const applySafeScale = window.applySafeScale;
  const positionModelOnSurface = window.positionModelOnSurface;
  
  if (!GLTFLoader || !scene || !currentCamera) {
    console.error('Required Three.js components not available');
    if (callback && typeof callback === 'function') callback();
    return;
  }
  
  const loader = new GLTFLoader();
  loader.load(modelConfig.url, (gltf) => {
    const model = gltf.scene;
    
    // Store original model ID in userData for reference
    if (modelData.uuid) {
      model.userData.originalModelId = modelData.uuid;
      
      // Update the global ID mapping
      if (!window.modelIdMapping) window.modelIdMapping = {};
      window.modelIdMapping[modelData.uuid] = model.uuid;
    }
    
    // Set position
    model.position.set(
      modelData.position.x,
      modelData.position.y,
      modelData.position.z
    );
    
    // Set rotation
    model.rotation.set(
      modelData.rotation.x,
      modelData.rotation.y,
      modelData.rotation.z
    );
    
    // Apply scaling
    let actualScale;
    if (modelConfig.isImported) {
      const baseScale = modelConfig.scale || 1;
      actualScale = baseScale * modelData.scale;
      model.scale.set(actualScale, actualScale, actualScale);
      if (positionModelOnSurface) positionModelOnSurface(model);
    } else {
      if (applySafeScale) {
        actualScale = applySafeScale(model, modelData.scale, modelConfig);
      }
    }
    
    // Enable shadows
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(model);
    
    // Create transform controls
    const control = new TransformControls(currentCamera, renderer.domElement);
    control.setSpace("world");
    control.attach(model);
    control.setSize(0.8);
    control.addEventListener('dragging-changed', (event) => {
      if (orbit) orbit.enabled = !event.value;
      
      // Add undo/redo support for transform changes
      if (event.value === false && control.object) { // Dragging ended
        const currentTransformState = {
            position: control.object.position.clone(),
            scale: control.object.scale.clone(),
            rotation: control.object.rotation.clone()
        };
        // Find the modelInstance associated with this control.object
        const instance = modelInstances.find(inst => inst.model === control.object);
        if (instance && instance.initialTransformState) {
            // Only push to undo stack if there was an actual change
            if (!instance.initialTransformState.position.equals(currentTransformState.position) ||
                !instance.initialTransformState.scale.equals(currentTransformState.scale) ||
                !instance.initialTransformState.rotation.equals(currentTransformState.rotation)) {

                if (window.undoStack) {
                    window.undoStack.push({
                        type: 'transform',
                        modelId: control.object.uuid,
                        oldPosition: instance.initialTransformState.position,
                        oldScale: instance.initialTransformState.scale,
                        oldRotation: instance.initialTransformState.rotation,
                        newPosition: currentTransformState.position,
                        newScale: currentTransformState.scale,
                        newRotation: currentTransformState.rotation
                    });
                    if (window.undoStack.length > window.MAX_HISTORY_STATES) {
                        window.undoStack.shift();
                    }
                }
                
                if (window.redoStack) {
                    window.redoStack.length = 0; // Clear redo stack on new action
                }
            }
            instance.initialTransformState = null; // Reset initial state
        }
      } else if (event.value === true && control.object) { // Dragging started
          // Store the state of the object *before* the transformation begins
          const instance = modelInstances.find(inst => inst.model === control.object);
          if (instance) {
              instance.initialTransformState = {
                  position: control.object.position.clone(),
                  scale: control.object.scale.clone(),
                  rotation: control.object.rotation.clone()
              };
          }
      }
    });
    
    control.addEventListener('change', () => {
      if (window.markSceneAsChanged) window.markSceneAsChanged();
      if (scheduleRender) scheduleRender();
    });
    scene.add(control);
    if (controlsList) controlsList.push(control);
    control.setMode('translate');
    control.showX = true;
    control.showY = false;
    control.showZ = true;
    control.visible = false;
    control.enabled = false;
    
    // Track the model instance
    const modelInstance = {
      model: model,
      control: control,
      name: modelData.name,
      scale: modelData.scale,
      modelConfig: modelConfig,
      modelUrl: modelConfig.url
    };
    if (modelInstances) modelInstances.push(modelInstance);
    
    // Update ID mapping for undo/redo
    if (modelData.uuid && window.modelIdMapping) {
      window.modelIdMapping[modelData.uuid] = model.uuid;
    }
    
    if (updateSceneStats) updateSceneStats();
    if (scheduleRender) scheduleRender();
    
    // Call the callback function if provided
    if (callback && typeof callback === 'function') callback();
    
  }, undefined, (error) => {
    console.error('Error loading model:', modelData.name, error);
    // Call the callback even on error to ensure loading process continues
    if (callback && typeof callback === 'function') callback();
  });
}

// Show notification function (if not already defined)
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.right = '20px';
  notification.style.background = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff';
  notification.style.color = 'white';
  notification.style.padding = '12px 20px';
  notification.style.borderRadius = '6px';
  notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
  notification.style.zIndex = '10000';
  notification.style.fontSize = '14px';
  notification.style.maxWidth = '300px';
  notification.style.wordWrap = 'break-word';
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

// Export functions for use in other modules
window.saveProject = saveProject;
window.saveProjectToFirebase = saveProjectToFirebase; // Export the enhanced save function for auto-save
window.showSaveAsModal = showSaveAsModal;
window.openProject = openProject;
window.deleteProject = deleteProject;
window.hideCreateProjectModal = hideCreateProjectModal;
window.hideSaveAsModal = hideSaveAsModal;
window.hideDeleteProjectModal = hideDeleteProjectModal;
window.confirmDeleteProject = confirmDeleteProject;
window.showProjectsModal = showProjectsModal;
window.logoutUser = logoutUser;

// Set flag to indicate auth system is loaded
window.authSystemLoaded = true;

export { auth, db, currentUser, currentProject, saveProject };
