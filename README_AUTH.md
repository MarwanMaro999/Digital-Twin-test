# Holcim Digital Twin Builder - Authentication & Project Management

This Digital Twin application now includes comprehensive authentication and project management features using Firebase.

## Features Added

### 🔐 Authentication
- **Login Page**: First page that appears for all users
- **Sign Up**: Create new user accounts with email and password
- **Firebase Authentication**: Secure user management with Firebase Auth
- **Auto-login**: Users stay logged in across sessions

### 📁 Project Management
- **Create New Project**: Start fresh digital twin projects
- **Save Projects**: Save current scene with all models and settings
- **Load Existing Projects**: Open previously saved projects
- **Project Browser**: View all your projects with metadata
- **Delete Projects**: Remove unwanted projects

### 💾 Save Functionality
- **Auto Save**: Save button in the toolbar
- **Save As**: Create new projects from current scene
- **Keyboard Shortcuts**: Ctrl+S to save, Ctrl+P for project management
- **Scene Data**: Saves model positions, rotations, scales, camera position, and lighting settings

### 🎮 User Interface
- **Project Indicator**: Shows current project name in sidebar
- **Toolbar Integration**: Save and Projects buttons in main toolbar
- **Modal Dialogs**: Clean interface for authentication and project management
- **Notifications**: User feedback for all actions

## How to Use

### First Time Setup
1. Open the application
2. You'll see the login/signup modal
3. Create a new account or sign in with existing credentials
4. Choose to create a new project or open an existing one

### Creating Projects
1. Click "Create New Project" or use Ctrl+P
2. Enter project name and optional description
3. Start building your digital twin
4. Use Ctrl+S to save your progress

### Managing Projects
1. Click the "Projects" button in the toolbar or use Ctrl+P
2. View all your projects with creation dates and model counts
3. Open existing projects or create new ones
4. Delete unwanted projects

### Keyboard Shortcuts
- `Ctrl+S` - Save current project
- `Ctrl+P` - Open project management
- All existing shortcuts still work (W, E, C, Space, etc.)

## Firebase Configuration

The application uses Firebase for:
- **Authentication**: User registration and login
- **Firestore Database**: Project data storage
- **Security Rules**: Users can only access their own projects

### Security Rules
```javascript
// Users can only access their own projects
match /projects/{projectId} {
  allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
  allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
}
```

## Data Structure

### Project Document
```javascript
{
  name: "Project Name",
  description: "Optional description",
  userId: "firebase-user-id",
  createdAt: "2025-01-20T...",
  lastModified: "2025-01-20T...",
  modelCount: 5,
  sceneData: {
    models: [
      {
        name: "Model Name",
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1
      }
    ],
    camera: {
      position: { x: 0, y: 150, z: 1200 },
      target: { x: 0, y: 0, z: 0 },
      type: "perspective"
    },
    settings: {
      shadows: false,
      ambientLight: 0,
      directLight: 2
    }
  }
}
```

## Development Notes

### File Structure
- `auth.js` - Authentication and project management logic
- `drag.js` - Main application with 3D scene management
- `main.css` - Updated styles including authentication UI
- `index.html` - Updated to include authentication script

### Key Functions
- `saveProject()` - Save current scene to Firebase
- `loadProjectScene()` - Load saved project into scene
- `showProjectsModal()` - Display project management interface
- `getCurrentSceneData()` - Extract current scene state for saving

## Deployment

To deploy with Firebase:

1. Make sure Firebase is initialized in your project
2. Update Firestore security rules
3. Deploy with `firebase deploy`
4. Users will automatically see the authentication flow

The application is now ready for multi-user production use with secure project management!
