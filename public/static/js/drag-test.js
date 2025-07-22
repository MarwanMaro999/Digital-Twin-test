import * as THREE from 'three';
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { GLTFLoader } from 'jsm/loaders/GLTFLoader.js';

let cameraPersp, cameraOrtho, currentCamera;
let scene, renderer, orbit;
let mapSurface, gridHelper;
let hemiLight, dirLight;
const controlsList = [];
let selectedModel = null;
let selectedControl = null;
window.modelInstances = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Store the last used transform mode
let lastTransformMode = 'transform';

// Track unsaved changes
let hasUnsavedChanges = false;
window.hasUnsavedChanges = () => hasUnsavedChanges;
let lastSavedSceneState = null;
let hasShownChangeNotification = false; // Track if we've already shown the change notification

// --- Undo/Redo Feature Variables ---
const undoStack = [];
const redoStack = [];
const MAX_HISTORY_STATES = 50; // Limit the size of the undo/redo stacks

// Variable to store the state of the object *before* a transformation
let initialTransformState = null;

// Global storage for imported models
let importedModels = {};

const models = {
  'Silo': {
    url: './static/models/silo.glb',
    position: new THREE.Vector3(0, 0, 0),
    scale: 1, // Default scale
    scaleOptions: [1, 1.5, 2], // Available scale options
    realDimensions: { width: 25, height: 71, length: 25 }, // meters
    glbDimensions: { width: 7.79, height: 16.4, length: 7.79 }, // meters
  },
  'Preheater': {
    url: './static/models/preheater.glb',
    position: new THREE.Vector3(400, 0, 200),
    scale: 1, // Default scale
    scaleOptions: [1, 1.5, 2], // Available scale options
    realDimensions: { width: 96.62, height: 118, length: 186.76 }, // meters
    glbDimensions: { width: 10.4, height: 12.7, length: 20.1 }, // meters
  },
  'Storage': {
    url: './static/models/Storage.glb',
    position: new THREE.Vector3(300, 0, -200),
    scale: 1, // Default scale
    scaleOptions: [1, 1.5, 2], // Available scale options
    realDimensions: { width: 30, height: 100, length: 30 }, // meters (4.41km × 14.5km × 3.79km)
    glbDimensions: { width: 2.41, height: 7.31, length: 2.41 }, // meters (4.41km × 14.5km × 3.79km)
  }
};

// Function to scale model using real-world dimensions and align to ground
function scaleAndAlignModel(model, realDimensions, glbDimensions, scaleMultiplier = 1, groundY = 0) {
  if (!model || !realDimensions || !glbDimensions) return;

  // 1. Calculate per-axis scale based on real vs GLB dimensions, multiplied by scale factor
  const scaleX = (realDimensions.width  / glbDimensions.width) * scaleMultiplier;
  const scaleY = (realDimensions.height / glbDimensions.height) * scaleMultiplier;
  const scaleZ = (realDimensions.length / glbDimensions.length) * scaleMultiplier;

  // 2. Ensure minimum scale values to prevent extreme scaling issues
  const minScale = 0.01;
  const finalScaleX = Math.max(scaleX, minScale);
  const finalScaleY = Math.max(scaleY, minScale);
  const finalScaleZ = Math.max(scaleZ, minScale);

  // 3. Apply scaling
  model.scale.set(finalScaleX, finalScaleY, finalScaleZ);

  // 4. Force update the world matrix multiple times to ensure accuracy
  model.updateMatrixWorld(true);
  model.updateWorldMatrix(true, true);

  // 5. Compute bounding box AFTER scaling and matrix update
  const box = new THREE.Box3().setFromObject(model);
  
  // 6. Ensure we have a valid bounding box
  if (!box.isEmpty()) {
    const bottomY = box.min.y;
    // Align the bottom of the model to groundY = 0
    model.position.y = groundY - bottomY;
  } else {
    // Fallback if bounding box is invalid
    model.position.y = groundY;
  }
  
  // 7. Force another matrix update after positioning
  model.updateMatrixWorld(true);
  
  return model.position.y;
}

// Function to position model on surface (bottom touching ground) - legacy support
function positionModelOnSurface(model, groundY = 0) {
  // Force update the world matrix multiple times
  model.updateMatrixWorld(true);
  model.updateWorldMatrix(true, true);
  
  // Small delay to ensure geometry is fully loaded
  setTimeout(() => {
    model.updateMatrixWorld(true);
    model.updateWorldMatrix(true, true);
    
    // Calculate the bounding box of the model
    const box = new THREE.Box3().setFromObject(model);
    
    // Ensure we have a valid bounding box
    if (!box.isEmpty()) {
      const bottomY = box.min.y;
      // Position the model so its bottom touches the ground level
      model.position.y = groundY - bottomY;
    } else {
      // Fallback if bounding box is invalid
      console.warn('Model bounding box is empty, positioning at ground level');
      model.position.y = groundY;
    }
    
    // Force another matrix update after positioning
    model.updateMatrixWorld(true);
    scheduleRender();
  }, 10);
  
  return model.position.y;
}

// Function to get a valid scale within the allowed range
function getValidScale(requestedScale, minScale = 0.1, maxScale = 2) {
  // Clamp the scale to the valid range
  return Math.max(minScale, Math.min(maxScale, requestedScale));
}

// Utility function to apply safe scaling to a model
function applySafeScale(model, requestedScale, modelConfig) {
  // Get the valid scale within the allowed range
  const validScale = getValidScale(requestedScale, 0.1, 2);
  
  // Check if model has real-world dimensions for accurate scaling
  if (modelConfig.realDimensions && modelConfig.glbDimensions) {
    // Use real-world dimensions scaling with the scale multiplier
    scaleAndAlignModel(model, modelConfig.realDimensions, modelConfig.glbDimensions, validScale, 0);
  } else {
    // Fallback to uniform scaling
    model.scale.set(validScale, validScale, validScale);
    positionModelOnSurface(model, 0);
  }
  
  return validScale;
}

// Functions to track scene changes
function markSceneAsChanged() {
  if (!hasUnsavedChanges) {
    hasUnsavedChanges = true;
    saveSceneToCache();
    updateProjectNameDisplay();
  }
}

function showBriefChangeNotification() {
  // Remove any existing brief notifications
  const existingNotifications = document.querySelectorAll('.brief-change-notification');
  existingNotifications.forEach(notification => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  });
  
  // Create a brief, small notification
  const notification = document.createElement('div');
  notification.className = 'brief-change-notification';
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.right = '20px';
  notification.style.background = '#007bff';
  notification.style.color = 'white';
  notification.style.padding = '8px 12px';
  notification.style.borderRadius = '4px';
  notification.style.fontSize = '12px';
  notification.style.zIndex = '10001';
  notification.style.opacity = '0.9';
  notification.style.transition = 'opacity 0.3s ease';
  notification.textContent = 'Scene changed';
  
  document.body.appendChild(notification);
  
  // Auto-remove after 1 second with fade out
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 700);
}

function markSceneAsSaved() {
  hasUnsavedChanges = false;
  hasShownChangeNotification = false; // Reset notification flag when saved
  lastSavedSceneState = captureSceneState();
  updateProjectNameDisplay();
}

function captureSceneState() {
  return {
    modelCount: modelInstances.length,
    modelStates: modelInstances.map(instance => ({
      name: instance.name,
      position: instance.model.position.toArray(),
      rotation: instance.model.rotation.toArray(),
      scale: instance.model.scale.toArray()
    }))
  };
}

function updateProjectNameDisplay() {
  const projectNameElement = document.getElementById('projectName');
  const currentProjectElement = document.getElementById('currentProject');
  if (projectNameElement && currentProjectElement) {
    const projectName = projectNameElement.textContent.replace(' (unsaved)', '');
    if (hasUnsavedChanges) {
      projectNameElement.textContent = projectName + ' (unsaved)';
      currentProjectElement.style.color = '#e67e22'; // Orange color for unsaved
    } else {
      projectNameElement.textContent = projectName;
      currentProjectElement.style.color = '#666'; // Normal color
    }
  }
}

function showSaveConfirmationDialog(actionName, onSave, onDontSave, onCancel) {
  // Remove existing modal if any
  const existingModal = document.getElementById('save-confirmation-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'save-confirmation-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="background:#fff;padding:32px 28px 24px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:400px;max-width:90vw;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:32px;color:#e67e22;margin-bottom:12px;"><i class='fa-solid fa-exclamation-triangle'></i></div>
        <h3 style="margin:0 0 8px 0;font-size:20px;">Save Changes?</h3>
        <div style="color:#555;font-size:15px;">You have unsaved changes to your project. What would you like to do before ${actionName}?</div>
      </div>
      
      <div style="display:flex;justify-content:center;gap:12px;flex-wrap:wrap;">
        <button id="save-and-continue-btn" style="background:#28a745;color:#fff;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
          <i class="fa-solid fa-save"></i> Save & Continue
        </button>
        <button id="dont-save-btn" style="background:#dc3545;color:#fff;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
          <i class="fa-solid fa-times"></i> Don't Save
        </button>
        <button id="cancel-action-btn" style="background:#f1f3f5;color:#222;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
          <i class="fa-solid fa-ban"></i> Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('save-and-continue-btn').onclick = () => {
    modal.remove();
    onSave();
  };

  document.getElementById('dont-save-btn').onclick = () => {
    modal.remove();
    onDontSave();
  };

  document.getElementById('cancel-action-btn').onclick = () => {
    modal.remove();
    if (onCancel) onCancel();
  };
}

let needsRender = true;
let animationId;

// Mouse interaction functions for model selection
function onMouseClick(event) {
  // Calculate mouse position in normalized device coordinates
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Update the picking ray with the camera and mouse position
  raycaster.setFromCamera(mouse, currentCamera);

  // Calculate objects intersecting the picking ray
  const models = modelInstances.map(instance => instance.model);
  const intersects = raycaster.intersectObjects(models, true);

  if (intersects.length > 0) {
    // Find which model instance was clicked
    const clickedObject = intersects[0].object;
    let clickedModelInstance = null;
    
    // Traverse up the object hierarchy to find the root model
    let currentObject = clickedObject;
    while (currentObject && !clickedModelInstance) {
      clickedModelInstance = modelInstances.find(instance => instance.model === currentObject);
      currentObject = currentObject.parent;
    }
    
    if (clickedModelInstance) {
      if (selectedModel === clickedModelInstance) {
        // Clicked on already selected model, deselect
        deselectAllModels();
      } else {
        // Select the clicked model
        selectModel(clickedModelInstance);
      }
    }
  } else {
    // Clicked on empty space, deselect all
    deselectAllModels();
  }
}

function onMouseMove(event) {
  // Calculate mouse position in normalized device coordinates
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Update the picking ray with the camera and mouse position
  raycaster.setFromCamera(mouse, currentCamera);

  // Calculate objects intersecting the picking ray
  const models = modelInstances.map(instance => instance.model);
  const intersects = raycaster.intersectObjects(models, true);

  // Change cursor based on hover
  if (intersects.length > 0) {
    renderer.domElement.style.cursor = 'pointer';
  } else {
    renderer.domElement.style.cursor = 'default';
  }
}

// Model selection functions
function selectModel(modelInstance) {
  // Deselect previous model
  deselectAllModels();
  
  // Select new model
  selectedModel = modelInstance;
  selectedControl = modelInstance.control;
  
  // Show transform controls
  modelInstance.control.visible = true;
  modelInstance.control.enabled = true;
  
  // Apply the current transform mode to the newly selected model
  if (lastTransformMode === 'rotate') {
    modelInstance.control.setMode('rotate');
    modelInstance.control.showX = false;
    modelInstance.control.showY = true;
    modelInstance.control.showZ = false;
  } else {
    modelInstance.control.setMode('translate');
    modelInstance.control.showX = true;
    modelInstance.control.showY = false;
    modelInstance.control.showZ = true;
  }
  
  // Update sidebar
  updateSelectedModelControls(modelInstance);
  
  scheduleRender();
}

function deselectAllModels() {
  selectedModel = null;
  selectedControl = null;
  
  // Hide all transform controls
  controlsList.forEach(control => {
    control.visible = false;
    control.enabled = false;
  });
  
  // Update sidebar
  updateSelectedModelControls(null);
  
  scheduleRender();
}

// Scene management functions
function updateSceneStats() {
  const modelCount = modelInstances.length;
  const modelCountElement = document.getElementById('modelCount');
  if (modelCountElement) {
    modelCountElement.textContent = modelCount + ' model' + (modelCount !== 1 ? 's' : '');
  }
}

function clearScene() {
  // Custom modal confirmation dialog
  const existingModal = document.getElementById('clear-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'clear-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="background:#fff;padding:32px 28px 24px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:320px;max-width:90vw;text-align:center;">
      <div style="font-size:32px;color:#e03131;margin-bottom:12px;"><i class='fa-solid fa-trash'></i></div>
      <h3 style="margin:0 0 8px 0;font-size:20px;">Clear Scene?</h3>
      <div style="color:#555;font-size:15px;margin-bottom:18px;">Are you sure you want to remove all models from the scene? This action cannot be undone.</div>
      <div style="display:flex;justify-content:center;gap:16px;">
        <button id="clear-confirm-btn" style="background:#e03131;color:#fff;padding:8px 22px;border:none;border-radius:6px;font-size:15px;cursor:pointer;">Clear Scene</button>
        <button id="clear-cancel-btn" style="background:#f1f3f5;color:#222;padding:8px 22px;border:none;border-radius:6px;font-size:15px;cursor:pointer;">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('clear-cancel-btn').onclick = () => {
    modal.remove();
  };
  document.getElementById('clear-confirm-btn').onclick = () => {
    modal.remove();
    
    // Remove all models from scene
    modelInstances.forEach(instance => {
      scene.remove(instance.model);
      scene.remove(instance.control);
    });
    
    // Clear arrays
    modelInstances.length = 0;
    controlsList.length = 0;
    
    // Reset selection
    selectedModel = null;
    selectedControl = null;

    // Clear undo/redo stacks for a full scene clear
    undoStack.length = 0;
    redoStack.length = 0;
    
    // Update UI
    updateSceneStats();
    updateSelectedModelControls(null);
    
    // Mark scene as changed
    // (REMOVED) markSceneAsChanged();
    
    scheduleRender();
    showNotification('Scene cleared!', 'success');
  };
}

window.clearSceneSilently = function () {
  modelInstances.forEach(instance => {
    scene.remove(instance.model);
    scene.remove(instance.control);
  });

  modelInstances.length = 0;
  controlsList.length = 0;
  selectedModel = null;
  selectedControl = null;

  // Clear undo/redo stacks
  undoStack.length = 0;
  redoStack.length = 0;

  updateSceneStats();
  updateSelectedModelControls(null);
  markSceneAsSaved();
  scheduleRender();
};

window.loadLastSceneFromCache = function () {
  const cachedData = localStorage.getItem(CACHE_KEY);
  if (!cachedData) {
    showNotification('No previous scene found in cache', 'info');
    return;
  }

  const modelsData = JSON.parse(cachedData);
  let modelsLoaded = 0;

modelsData.forEach(data => {
  const modelConfig = models[data.name] || importedModels[data.name];
  if (!modelConfig) return;

  const loader = new GLTFLoader();
  loader.load(modelConfig.url, (gltf) => {
    const model = gltf.scene;
    model.position.fromArray(data.position);
    model.rotation.fromArray(data.rotation);
    model.scale.fromArray(data.scale);

    model.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(model);

    const control = new TransformControls(currentCamera, renderer.domElement);
    control.attach(model);
    control.setSize(0.8);
    control.visible = false;
    control.enabled = false;

    // Track when user finishes dragging (undo/redo removed)
    control.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
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

                undoStack.push({
                    type: 'transform',
                    modelId: control.object.uuid,
                    oldPosition: instance.initialTransformState.position,
                    oldScale: instance.initialTransformState.scale,
                    oldRotation: instance.initialTransformState.rotation,
                    newPosition: currentTransformState.position,
                    newScale: currentTransformState.scale,
                    newRotation: currentTransformState.rotation
                });
                if (undoStack.length > MAX_HISTORY_STATES) {
                    undoStack.shift();
                }
                redoStack.length = 0; // Clear redo stack on new action
                console.log("Transform action recorded (from cache load). Stack size:", undoStack.length);
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
      markSceneAsChanged();
      scheduleRender();
    });

    scene.add(control);
    controlsList.push(control);

    modelInstances.push({
      model,
      control,
      name: data.name,
      scale: data.scale,
      modelConfig
    });

    modelsLoaded++;

    updateSceneStats();
    scheduleRender();

  });
});

  // Removed undo/redo initial state save
};

function takeScreenshot() {
  // Temporarily hide all transform controls for clean screenshot
  const controlsVisibility = controlsList.map(control => control.visible);
  controlsList.forEach(control => {
    control.visible = false;
  });
  
  // Render the scene
  render();
  
  // Create download link
  const link = document.createElement('a');
  link.download = 'scene_screenshot_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.png';
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
  
  // Restore transform controls visibility
  controlsList.forEach((control, index) => {
    control.visible = controlsVisibility[index];
  });
  
  scheduleRender();
  showNotification('Screenshot saved!', 'success');
}

// Notification system
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

// Import model functionality
function showImportModelModal() {
  // Remove existing modal if any
  const existingModal = document.getElementById('import-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'import-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="background:#fff;padding:32px 28px 24px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:400px;max-width:90vw;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:32px;color:#339af0;margin-bottom:12px;"><i class='fa-solid fa-file-import'></i></div>
        <h3 style="margin:0 0 8px 0;font-size:20px;">Import GLB Model</h3>
        <div style="color:#555;font-size:15px;">Choose a GLB file to import into your library</div>
      </div>
      
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;">Model Name:</label>
        <input type="text" id="modelName" placeholder="Enter model name" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;">
      </div>
      
      <div style="margin-bottom:16px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;">Real Height (meters):</label>
        <input type="number" id="realHeight" placeholder="Enter real height in meters" step="0.1" min="0.1" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;">
        <div style="color:#666;font-size:12px;margin-top:4px;">
          <i class="fa-solid fa-info-circle"></i> This will be used to scale the model proportionally to the map
        </div>
      </div>
      
      <div style="margin-bottom:20px;">
        <label style="display:block;margin-bottom:6px;font-weight:500;">GLB File:</label>
        <input type="file" id="glbFile" accept=".glb" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;">
      </div>
      
      <div style="display:flex;justify-content:flex-end;gap:12px;">
        <button id="import-cancel-btn" style="background:#f1f3f5;color:#222;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Cancel</button>
        <button id="import-confirm-btn" style="background:#339af0;color:#fff;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Import</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('import-cancel-btn').onclick = () => {
    modal.remove();
  };
  
  document.getElementById('import-confirm-btn').onclick = () => {
    const modelName = document.getElementById('modelName').value.trim();
    const realHeight = parseFloat(document.getElementById('realHeight').value);
    const glbFile = document.getElementById('glbFile').files[0];
    
    if (!modelName) {
      showNotification('Please enter a model name', 'error');
      return;
    }
    
    if (!realHeight || realHeight <= 0) {
      showNotification('Please enter a valid real height in meters', 'error');
      return;
    }
    
    if (!glbFile) {
      showNotification('Please select a GLB file', 'error');
      return;
    }
    
    modal.remove();
    importGLBModel(modelName, glbFile, realHeight);
  };
  
  // Auto-focus on model name input
  setTimeout(() => {
    document.getElementById('modelName').focus();
  }, 100);
}

// Add a function to reset to default view
function resetToDefaultView() {
  // Switch to perspective camera
  currentCamera = cameraPersp;
  
  // Set default position focused on the map center
  currentCamera.position.set(0, 1000, 900);
  currentCamera.lookAt(0, 0, 0);
  
  // Update orbit controls
  orbit.object = currentCamera;
  orbit.target.set(0, 0, 0);
  orbit.update();
  
  // Update all transform controls
  controlsList.forEach(control => {
    control.camera = currentCamera;
  });
  
  // Update render mode display
  const renderModeElement = document.getElementById('renderMode');
  if (renderModeElement) {
    renderModeElement.textContent = 'Perspective';
  }
  scheduleRender();
}

// Window resize handler
function onWindowResize() {
  const aspect = window.innerWidth / window.innerHeight;
  
  if (currentCamera.isPerspectiveCamera) {
    currentCamera.aspect = aspect;
  } else {
    currentCamera.left = -921.5 * aspect;
    currentCamera.right = 921.5 * aspect;
    currentCamera.top = 921.5;
    currentCamera.bottom = -921.5;
  }
  
  currentCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  scheduleRender();
}

// Render function
function render() {
  renderer.render(scene, currentCamera);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  
  // Update controls in animation loop for smoother movement
  if (orbit.enableDamping) {
    orbit.update();
  }
  
  if (needsRender || orbit.enableDamping) {
    render();
    needsRender = false;
  }
}

function scheduleRender() {
  needsRender = true;
}

const CACHE_KEY = 'sceneCache';


function saveSceneToCache() {
  const data = scene.children
    .filter(obj => obj.isMesh && obj.name !== 'MapSurface') // skip map/grid/etc.
    .map(model => ({
      name: model.userData.modelName || model.name,
      position: model.position.toArray(),
      scale: model.scale.toArray(),
      rotation: model.rotation.toArray()
    }));
  
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  hasUnsavedChanges = false;
}


// Immediately initialize the scene and start animation
init();
animate();

function init() {
  renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    powerPreference: "high-performance",
    stencil: false,
    depth: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Further limit pixel ratio
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.BasicShadowMap; // Use basic shadows for better performance
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false; // Prevent automatic reset for better performance
  document.body.appendChild(renderer.domElement);

  const aspect = window.innerWidth / window.innerHeight;
  cameraPersp = new THREE.PerspectiveCamera(70, aspect, 0.01, 30000);
  cameraOrtho = new THREE.OrthographicCamera(-921.5 * aspect, 921.5 * aspect, 921.5, -921.5, 0.01, 30000);  // Half of 1843 for bounds
  currentCamera = cameraPersp;
  currentCamera.position.set(0, 1000, 900); // Further back to see entire map
  currentCamera.lookAt(0, 0, 0); // Look at map center

  scene = new THREE.Scene();
  
  // Create realistic sky gradient background
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  
  // Create gradient from horizon to zenith
  const gradient = context.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#87CEEB'); // Sky blue at horizon
  gradient.addColorStop(0.4, '#B0E0E6'); // Powder blue
  gradient.addColorStop(0.7, '#E6F3FF'); // Very light blue
  gradient.addColorStop(1, '#F0F8FF'); // Alice blue at zenith
  
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  
  const skyTexture = new THREE.CanvasTexture(canvas);
  scene.background = skyTexture;
  
  // Add subtle fog for depth
  scene.fog = new THREE.Fog(0x87CEEB, 2000, 8000);

  // Improved lighting setup
  hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x888888, 0.8); // Sky blue and soft ground
  scene.add(hemiLight);

  dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(2000, 2000, 1000);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024; // Reduced from 2048 for better performance
  dirLight.shadow.mapSize.height = 1024; // Reduced from 2048 for better performance
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 5000;
  dirLight.shadow.camera.left = -2000;
  dirLight.shadow.camera.right = 2000;
  dirLight.shadow.camera.top = 2000;
  dirLight.shadow.camera.bottom = -2000;
  scene.add(dirLight);

  // Additional fill light
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-1000, 1000, -1000);
  scene.add(fillLight);

  // Improved map setup
  const mapTexture = new THREE.TextureLoader().load('./static/img/Lafarge Map.png', scheduleRender);
  mapTexture.wrapS = THREE.RepeatWrapping;
  mapTexture.wrapT = THREE.RepeatWrapping;
  mapTexture.generateMipmaps = false;
  mapTexture.minFilter = THREE.LinearFilter;
  mapTexture.magFilter = THREE.LinearFilter;
  
  const mapGeometry = new THREE.PlaneGeometry(1843, 1843);
  mapGeometry.rotateX(-Math.PI / 2);
  const mapMaterial = new THREE.MeshLambertMaterial({ 
    map: mapTexture,
    transparent: true,
    opacity: 0.9
  });
  mapSurface = new THREE.Mesh(mapGeometry, mapMaterial);
  mapSurface.receiveShadow = true;
  mapSurface.position.y = 0; // Lower the map so y=0 is ground level for the models
  scene.add(mapSurface);

  orbit = new OrbitControls(currentCamera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08; // Smoother damping
  orbit.maxPolarAngle = Math.PI * 0.48; // Allow slightly more vertical rotation
  orbit.minPolarAngle = Math.PI * 0.1; // Prevent going too low
  orbit.minDistance = 10;
  orbit.maxDistance = 3000;
  orbit.autoRotate = false;
  orbit.enablePan = true;
  orbit.panSpeed = 0.8; // Smoother panning
  orbit.rotateSpeed = 0.5; // Smoother rotation
  orbit.zoomSpeed = 0.8; // Smoother zoom
  orbit.screenSpacePanning = false; // Better panning behavior
  orbit.enableKeys = true; // Enable keyboard controls
  orbit.keys = {
    LEFT: 'ArrowLeft',
    UP: 'ArrowUp', 
    RIGHT: 'ArrowRight',
    DOWN: 'ArrowDown'
  };
  orbit.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  orbit.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  
  // Set initial orbit target to map center
  orbit.target.set(0, 0, 0);
  orbit.update();

  // Create professional sidebar with tabbed interface
  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar';

  // Sidebar header with scene info
  const sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'sidebar-header';
  sidebarHeader.innerHTML = `
    <div class="scene-info">
      <h3><img src="./static/img/Holcim Logo.png" alt="HOLN Logo" style="width: 24px; height: 24px; margin-right: 8px; vertical-align: middle;"> Holcim Digital Twin Builder</h3>
      <div id="currentProject" class="current-project" style="display: none; font-size: 12px; color: #666; margin-bottom: 8px;">
        <i class="fa-solid fa-folder-open"></i> <span id="projectName">No project loaded</span>
      </div>
      <div class="scene-stats">
        <span id="modelCount">0 models</span>
        <span id="renderMode">Perspective</span>
      </div>
    </div>
  `;
  sidebar.appendChild(sidebarHeader);

  // Sidebar tabs
  const sidebarTabs = document.createElement('div');
  sidebarTabs.className = 'sidebar-tabs';
  sidebarTabs.innerHTML = `
    <button class="sidebar-tab active" data-tab="library">
      <i class="fa-solid fa-plus"></i> Library
    </button>
    <button class="sidebar-tab" data-tab="selected">
      <i class="fa-solid fa-crosshairs"></i> Selected
    </button>
    <button class="sidebar-tab" data-tab="scene">
      <i class="fa-solid fa-cog"></i> Scene
    </button>
  `;
  sidebar.appendChild(sidebarTabs);

  // Sidebar content container
  const sidebarContent = document.createElement('div');
  sidebarContent.className = 'sidebar-content';
  sidebar.appendChild(sidebarContent);

  // Library tab content
  const libraryContent = document.createElement('div');
  libraryContent.className = 'tab-content active';
  libraryContent.id = 'library-tab';
  libraryContent.innerHTML = `
    <div class="content-section">
      <h4><i class="fa-solid fa-shapes"></i> Model Library</h4>
      <button id="importModelBtn" class="btn-toolbar" style="margin-bottom:10px;">
        <i class="fa-solid fa-file-import"></i> Import Model
      </button>
    </div>
    <div class="model-grid">
      ${Object.keys(models).map(name => `
        <div class="model-item" draggable="true" data-model="${name}">
          <div class="model-icon">
            <i class="fa-solid fa-cube"></i>
          </div>
          <div class="model-info">
            <span class="model-name">${name}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  sidebarContent.appendChild(libraryContent);

  // Setup drag and drop for existing models immediately
  setupModelDragAndDrop();

  // Add Import Model button event (use DOMContentLoaded for reliability)
  document.addEventListener('DOMContentLoaded', () => {
    const importBtn = document.getElementById('importModelBtn');
    if (importBtn) {
      importBtn.onclick = showImportModelModal;
    }
  });
  // Also try immediately in case DOM is ready
  setTimeout(() => {
    const importBtn = document.getElementById('importModelBtn');
    if (importBtn) {
      importBtn.onclick = showImportModelModal;
    }
  }, 100);

  // Setup drag and drop for the initial model items
  // Use multiple methods to ensure DOM is ready
  setTimeout(() => {
    setupModelDragAndDrop();
  }, 100);
  
  // Also try when DOM is fully loaded
  document.addEventListener('DOMContentLoaded', () => {
    setupModelDragAndDrop();
  });
  
  // And try after a longer delay to ensure everything is rendered
  setTimeout(() => {
    setupModelDragAndDrop();
  }, 500);

  // Selected model tab content
  const selectedContent = document.createElement('div');
  selectedContent.className = 'tab-content';
  selectedContent.id = 'selected-tab';
  selectedContent.innerHTML = `
    <div class="content-section">
      <div class="no-selection">
        <i class="fa-solid fa-mouse-pointer"></i>
        <h4>No Model Selected</h4>
        <p>Click on a model in the scene to edit its properties</p>
      </div>
      <div class="selected-model-controls" style="display: none;">
        <!-- Selected model controls will be inserted here dynamically -->
      </div>
    </div>
  `;
  sidebarContent.appendChild(selectedContent);

  // Scene settings tab content
  const sceneContent = document.createElement('div');
  sceneContent.className = 'tab-content';
  sceneContent.id = 'scene-tab';
  sceneContent.innerHTML = `
    <div class="content-section">
      <h4><i class="fa-solid fa-eye"></i> Visibility</h4>
      <div class="control-group">
        <label class="checkbox-label">
          <input type="checkbox" id="showShadows">
          <span class="checkbox-custom"></span>
          <span>Shadows</span>
        </label>
      </div>
    </div>
    <div class="content-section">
      <h4><i class="fa-solid fa-lightbulb"></i> Lighting</h4>
      <div class="control-group">
        <label class="range-label">
          <span>Sky Light</span>
          <input type="range" id="ambientLight" min="0" max="2" step="0.1" value="0">
          <span class="range-value">0</span>
        </label>
        <label class="range-label">
          <span>Directional Light</span>
          <input type="range" id="directLight" min="0" max="2" step="0.1" value="2">
          <span class="range-value">2</span>
        </label>
      </div>
    </div>
  `;
  sidebarContent.appendChild(sceneContent);

  document.body.appendChild(sidebar);

  // Setup tab switching
  const tabs = document.querySelectorAll('.sidebar-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Show corresponding content
      const targetTab = tab.getAttribute('data-tab');
      document.getElementById(targetTab + '-tab').classList.add('active');
    });
  });

  // Setup scene controls event listeners
  document.getElementById('showShadows').addEventListener('change', (e) => {
    renderer.shadowMap.enabled = e.target.checked;
    
    // Force update all materials to reflect shadow changes
    scene.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.needsUpdate = true;
      }
    });
    
    // Force renderer to rebuild shadow maps
    renderer.shadowMap.needsUpdate = true;
    
    scheduleRender();
  });

  document.getElementById('ambientLight').addEventListener('input', (e) => {
    hemiLight.intensity = parseFloat(e.target.value);
    e.target.nextElementSibling.textContent = e.target.value;
    scheduleRender();
  });

  // Set initial hemisphere light intensity to 0
  hemiLight.intensity = 0;

  document.getElementById('directLight').addEventListener('input', (e) => {
    dirLight.intensity = parseFloat(e.target.value);
    e.target.nextElementSibling.textContent = e.target.value;
    scheduleRender();
  });

  // Mouse interaction functions for model selection
  function onMouseClick(event) {
    // Calculate mouse position in normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, currentCamera);

    // Calculate objects intersecting the picking ray
    const models = modelInstances.map(instance => instance.model);
    const intersects = raycaster.intersectObjects(models, true);

    if (intersects.length > 0) {
      // Find which model instance was clicked
      const clickedObject = intersects[0].object;
      let clickedModelInstance = null;
      
      // Traverse up the object hierarchy to find the root model
      let currentObject = clickedObject;
      while (currentObject && !clickedModelInstance) {
        clickedModelInstance = modelInstances.find(instance => instance.model === currentObject);
        currentObject = currentObject.parent;
      }
      
      if (clickedModelInstance) {
        if (selectedModel === clickedModelInstance) {
          // Clicked on already selected model, deselect
          deselectAllModels();
        } else {
          // Select the clicked model
          selectModel(clickedModelInstance);
        }
      }
    } else {
      // Clicked on empty space, deselect all
      deselectAllModels();
    }
  }

  function onMouseMove(event) {
    // Calculate mouse position in normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, currentCamera);

    // Calculate objects intersecting the picking ray
    const models = modelInstances.map(instance => instance.model);
    const intersects = raycaster.intersectObjects(models, true);

    // Change cursor based on hover
    if (intersects.length > 0) {
      renderer.domElement.style.cursor = 'pointer';
    } else {
      renderer.domElement.style.cursor = 'default';
    }
  }

  // Model selection functions
  function selectModel(modelInstance) {
    // Deselect previous model
    deselectAllModels();
    
    // Select new model
    selectedModel = modelInstance;
    selectedControl = modelInstance.control;
    
    // Show transform controls
    modelInstance.control.visible = true;
    modelInstance.control.enabled = true;
    
    // Apply the current transform mode to the newly selected model
    if (lastTransformMode === 'rotate') {
      modelInstance.control.setMode('rotate');
      modelInstance.control.showX = false;
      modelInstance.control.showY = true;
      modelInstance.control.showZ = false;
    } else {
      modelInstance.control.setMode('translate');
      modelInstance.control.showX = true;
      modelInstance.control.showY = false;
      modelInstance.control.showZ = true;
    }
    
    // Update sidebar
    updateSelectedModelControls(modelInstance);
      // Automatically switch to "Selected" tab
    document.querySelectorAll('.sidebar-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

    const selectedTab = document.querySelector('.sidebar-tab[data-tab="selected"]');
    if (selectedTab) selectedTab.classList.add('active');

    const selectedTabContent = document.getElementById('selected-tab');
    if (selectedTabContent) selectedTabContent.classList.add('active');

    scheduleRender();
  }

  function deselectAllModels() {
    selectedModel = null;
    selectedControl = null;
    
    // Hide all transform controls
    controlsList.forEach(control => {
      control.visible = false;
      control.enabled = false;
    });
    
    // Update sidebar
    updateSelectedModelControls(null);
    
    scheduleRender();
  }

  // Scene management functions
  function updateSceneStats() {
    const modelCount = modelInstances.length;
    const modelCountElement = document.getElementById('modelCount');
    if (modelCountElement) {
      modelCountElement.textContent = modelCount + ' model' + (modelCount !== 1 ? 's' : '');
    }
  }

  function takeScreenshot() {
    // Temporarily hide all transform controls for clean screenshot
    const controlsVisibility = controlsList.map(control => control.visible);
    controlsList.forEach(control => {
      control.visible = false;
    });
    
    // Render the scene
    render();
    
    // Create download link
    const link = document.createElement('a');
    link.download = 'scene_screenshot_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
    
    // Restore transform controls visibility
    controlsList.forEach((control, index) => {
      control.visible = controlsVisibility[index];
    });
    
    scheduleRender();
    showNotification('Screenshot saved!', 'success');
  }

  // Notification system
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

  // Import model functionality
  function showImportModelModal() {
    // Remove existing modal if any
    const existingModal = document.getElementById('import-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'import-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.35)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
      <div style="background:#fff;padding:32px 28px 24px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:400px;max-width:90vw;">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:32px;color:#339af0;margin-bottom:12px;"><i class='fa-solid fa-file-import'></i></div>
          <h3 style="margin:0 0 8px 0;font-size:20px;">Import GLB Model</h3>
          <div style="color:#555;font-size:15px;">Choose a GLB file to import into your library</div>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:6px;font-weight:500;">Model Name:</label>
          <input type="text" id="modelName" placeholder="Enter model name" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;">
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:6px;font-weight:500;">Real Height (meters):</label>
          <input type="number" id="realHeight" placeholder="Enter real height in meters" step="0.1" min="0.1" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;">
          <div style="color:#666;font-size:12px;margin-top:4px;">
            <i class="fa-solid fa-info-circle"></i> This will be used to scale the model proportionally to the map
          </div>
        </div>
        
        <div style="margin-bottom:20px;">
          <label style="display:block;margin-bottom:6px;font-weight:500;">GLB File:</label>
          <input type="file" id="glbFile" accept=".glb" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;">
        </div>
        
        <div style="display:flex;justify-content:flex-end;gap:12px;">
          <button id="import-cancel-btn" style="background:#f1f3f5;color:#222;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Cancel</button>
          <button id="import-confirm-btn" style="background:#339af0;color:#fff;padding:10px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Import</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('import-cancel-btn').onclick = () => {
      modal.remove();
    };
    
    document.getElementById('import-confirm-btn').onclick = () => {
      const modelName = document.getElementById('modelName').value.trim();
      const realHeight = parseFloat(document.getElementById('realHeight').value);
      const glbFile = document.getElementById('glbFile').files[0];
      
      if (!modelName) {
        showNotification('Please enter a model name', 'error');
        return;
      }
      
      if (!realHeight || realHeight <= 0) {
        showNotification('Please enter a valid real height in meters', 'error');
        return;
      }
      
      if (!glbFile) {
        showNotification('Please select a GLB file', 'error');
        return;
      }
      
      modal.remove();
      importGLBModel(modelName, glbFile, realHeight);
    };
    
    // Auto-focus on model name input
    setTimeout(() => {
      document.getElementById('modelName').focus();
    }, 100);
  }

  function importGLBModel(modelName, glbFile, realHeight) {
    // Show loading notification
    showNotification('Importing model...', 'info');
    
    // Create a URL for the file
    const fileURL = URL.createObjectURL(glbFile);
    
    // Map ratio: 156.66m = 153px
    const mapRatio = 156.66 / 153; // meters per pixel
    const mapSize = 1843; // pixels
    const mapRealSize = mapSize * mapRatio; // real meters
    
    // Load the model temporarily to calculate appropriate dimensions
    const loader = new GLTFLoader();
    loader.load(fileURL, (gltf) => {
      const tempModel = gltf.scene;
      
      // Calculate the model's bounding box
      const box = new THREE.Box3().setFromObject(tempModel);
      const size = box.getSize(new THREE.Vector3());
      
      // Calculate scale based on real height provided by user
      const modelGLBHeight = size.y;
      const heightScale = realHeight / modelGLBHeight;
      
      // Apply uniform scaling based on height
      const calculatedScale = heightScale;
      
      // Apply reasonable bounds to keep models manageable
      const minScale = 0.1;   // Minimum scale for visibility
      const maxScale = 500.0; // Maximum scale to prevent huge models
      const defaultScale = Math.max(minScale, Math.min(maxScale, calculatedScale));
      
      // Calculate final real dimensions after scaling
      const finalRealDimensions = {
        width: size.x * defaultScale,
        height: size.y * defaultScale,
        length: size.z * defaultScale
      };
      
      // Store the imported model configuration
      importedModels[modelName] = {
        url: fileURL,
        position: new THREE.Vector3(0, 0, 0),
        scale: defaultScale,
        scaleOptions: [0.1, 0.5, 1, 1.5, 2],
        isImported: true,
        originalSize: size.clone(),
        recommendedScale: defaultScale,
        userProvidedHeight: realHeight,
        // Add dimensions for proper scaling
        realDimensions: finalRealDimensions,
        glbDimensions: { 
          width: size.x, 
          height: size.y, 
          length: size.z 
        }
      };
    
    // Clean up the temporary model
    tempModel.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    
    // Update the library grid
    updateLibraryGrid();
    
    // Show success message with scaling information
    const mapPercentage = (Math.max(finalRealDimensions.width, finalRealDimensions.height, finalRealDimensions.length) / mapRealSize) * 100;
    showNotification(`"${modelName}" imported! Real height: ${realHeight}m, Scale: ${defaultScale.toFixed(2)}x, Map size: ${mapPercentage.toFixed(1)}%`, 'success');
    
    console.log(`Imported model "${modelName}":`, {
      userProvidedHeight: `${realHeight}m`,
      glbHeight: `${modelGLBHeight.toFixed(2)}`,
      calculatedScale: `${calculatedScale.toFixed(2)}x`,
      appliedScale: `${defaultScale.toFixed(2)}x`,
      finalRealDimensions: {
        width: `${finalRealDimensions.width.toFixed(2)}m`,
        height: `${finalRealDimensions.height.toFixed(2)}m`,
        length: `${finalRealDimensions.length.toFixed(2)}m`
      },
      mapRealSize: `${mapRealSize.toFixed(2)}m`,
      mapPercentage: `${mapPercentage.toFixed(1)}%`
    });
    }, undefined, (error) => {
      console.error('Error loading imported model:', error);
      showNotification('Error importing model', 'error');
      // Clean up the URL on error
      URL.revokeObjectURL(fileURL);
    });
  }

 window.addEventListener('keydown', (event) => {
  // Don't process keyboard shortcuts when user is typing in input fields
  const isTyping = document.activeElement.tagName === 'INPUT' || 
                   document.activeElement.tagName === 'TEXTAREA' ||
                   document.activeElement.isContentEditable;

  const isCtrlCmd = event.ctrlKey || event.metaKey;

  // Allow spacebar in inputs
  if (event.key === ' ' && isTyping) return;

  // Block non-shortcuts while typing
  if (isTyping && !isCtrlCmd) return;
  if (!event.key) return;

  switch (event.key.toLowerCase()) {
    case 'shift':
      if (selectedControl) {
        selectedControl.setTranslationSnap(100);
        selectedControl.setRotationSnap(THREE.MathUtils.degToRad(15));
        selectedControl.setScaleSnap(0.25);
      }
      break;

    case 'w':
      if (selectedControl) {
        selectedControl.setMode('translate');
        selectedControl.showX = true;
        selectedControl.showY = false;
        selectedControl.showZ = true;
        lastTransformMode = 'transform';
        updateTransformModeButtons('transform');
      }
      break;

    case 'e':
      if (selectedControl) {
        selectedControl.setMode('rotate');
        selectedControl.showX = false;
        selectedControl.showY = true;
        selectedControl.showZ = false;
        lastTransformMode = 'rotate';
        updateTransformModeButtons('rotate');
      }
      break;

    case '+':
    case '=':
      if (selectedControl) {
        selectedControl.setSize(selectedControl.size + 0.1);
      }
      break;

    case '-':
    case '_':
      if (selectedControl) {
        selectedControl.setSize(Math.max(selectedControl.size - 0.1, 0.1));
      }
      break;

    case 'x':
      if (selectedControl) {
        selectedControl.showX = !selectedControl.showX;
      }
      break;

    case 'y':
      if (selectedControl) {
        selectedControl.showY = !selectedControl.showY;
      }
      break;

    case 'z':
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault(); // Prevent browser default undo/redo
        if (event.shiftKey) {
          redo(); // Ctrl+Shift+Z
        } else {
          undo(); // Ctrl+Z
        }
      } else if (selectedControl) {
        selectedControl.showZ = !selectedControl.showZ; // Regular Z
      }
      break;

    case ' ':
      if (!isTyping) {
        event.preventDefault();
        deselectAllModels();
      }
      break;

    case 'escape':
      deselectAllModels();
      break;

    case 'c':
      const pos = currentCamera.position.clone();
      currentCamera = currentCamera.isPerspectiveCamera ? cameraOrtho : cameraPersp;
      currentCamera.position.copy(pos);
      currentCamera.lookAt(orbit.target);
      orbit.object = currentCamera;
      controlsList.forEach(c => c.camera = currentCamera);

      const renderModeElement = document.getElementById('renderMode');
      if (renderModeElement) {
        renderModeElement.textContent = currentCamera.isPerspectiveCamera ? 'Perspective' : 'Orthographic';
      }

      onWindowResize();
      break;

    case 's':
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const trySaveProject = (attempts = 0) => {
          if (typeof window.saveProject === 'function') {
            window.saveProject();
          } else if (attempts < 10) {
            setTimeout(() => trySaveProject(attempts + 1), 100);
          } else {
            showNotification('Authentication system not loaded', 'error');
          }
        };
        trySaveProject();
      }
      break;

    case 'p':
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
          window.showSaveConfirmationDialog(
            'opening projects manager',
            () => {
              const trySaveProject = (attempts = 0) => {
                if (typeof window.saveProject === 'function') {
                  window.saveProject().then(() => {
                    setTimeout(() => {
                      if (typeof window.showProjectsModal === 'function') {
                        window.showProjectsModal();
                      }
                    }, 100);
                  });
                } else if (attempts < 10) {
                  setTimeout(() => trySaveProject(attempts + 1), 100);
                } else {
                  showNotification('Authentication system not loaded', 'error');
                }
              };
              trySaveProject();
            },
            () => {
              const tryShowProjects = (attempts = 0) => {
                if (typeof window.showProjectsModal === 'function') {
                  window.showProjectsModal();
                } else if (attempts < 10) {
                  setTimeout(() => tryShowProjects(attempts + 1), 100);
                } else {
                  showNotification('Authentication system not loaded', 'error');
                }
              };
              tryShowProjects();
            },
            null
          );
        } else {
          const tryShowProjects = (attempts = 0) => {
            if (typeof window.showProjectsModal === 'function') {
              window.showProjectsModal();
            } else if (attempts < 10) {
              setTimeout(() => tryShowProjects(attempts + 1), 100);
            } else {
              showNotification('Authentication system not loaded', 'error');
            }
          };
          tryShowProjects();
        }
      }
      break;
  }
});


  window.addEventListener('keyup', (e) => {
    if (e.key && e.key.toLowerCase() === 'shift') {
      if (selectedControl) {
        selectedControl.setTranslationSnap(null);
        selectedControl.setRotationSnap(null);
        selectedControl.setScaleSnap(null);
      }
    }
  });

  window.addEventListener('resize', onWindowResize);
  // Auto-save every 5 seconds if there are unsaved changes
  setInterval(() => {
  if (hasUnsavedChanges) {
    console.log('[AutoSave] Saving scene...');
    saveSceneToCache();
  }
}, 1000);



  // Add mouse event listeners for model selection
  renderer.domElement.addEventListener('click', onMouseClick);
  renderer.domElement.addEventListener('mousemove', onMouseMove);

  // Drag-and-drop handlers
renderer.domElement.addEventListener('dragover', (event) => {
  event.preventDefault(); // Necessary for drop to work
});

renderer.domElement.addEventListener('drop', (event) => {
  event.preventDefault();

  const modelName = event.dataTransfer.getData('model-name');
  const modelURL = event.dataTransfer.getData('model-url');
  const isImported = event.dataTransfer.getData('is-imported') === 'true';

  const allModels = { ...models, ...importedModels };
  const modelConfig = allModels[modelName];
  
  if (!modelConfig) {
    console.error('Model config not found for:', modelName);
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(mouse, currentCamera);
  const intersects = raycaster.intersectObject(mapSurface);
  
  if (intersects.length === 0) {
    console.log('No intersections with map surface');
    return;
  }

  const dropPoint = intersects[0].point;

  const loader = new GLTFLoader();
  loader.load(modelURL, (gltf) => {
    const model = gltf.scene;
    model.position.copy(dropPoint);
    model.rotation.set(0, 0, 0);

    // Apply scaling based on model type
    let finalScale;
    if (modelConfig.isImported) {
      // For imported models, use the calculated scale as base scale
      finalScale = modelConfig.scale || 1;
      model.scale.set(finalScale, finalScale, finalScale);
      
      // Force update the world matrix after scaling
      model.updateMatrixWorld(true);
      model.updateWorldMatrix(true, true);
      
      // Position model on surface after scaling with proper ground alignment
      setTimeout(() => {
        // Ensure the model is fully processed
        model.updateMatrixWorld(true);
        model.updateWorldMatrix(true, true);
        
        // Calculate the bounding box of the model
        const box = new THREE.Box3().setFromObject(model);
        
        if (!box.isEmpty()) {
          const bottomY = box.min.y;
          // Position the model so its bottom touches the ground level (y = 0)
          // The dropPoint.y should be 0 (map surface level), so we adjust accordingly
          model.position.y = 0 - bottomY;
        } else {
          // Fallback if bounding box is invalid
          model.position.y = 0;
        }
        
        // Force another matrix update after positioning
        model.updateMatrixWorld(true);
        scheduleRender();
      }, 50);
    } else {
      // For existing models, use the scaling function with initial scale of 1
      const initialScale = 1;
      finalScale = applySafeScale(model, initialScale, modelConfig);
    }

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(model);
    markSceneAsChanged();

    const control = new TransformControls(currentCamera, renderer.domElement);
    control.setSpace("world");
    control.attach(model);
    control.setSize(0.8);
    
    // Apply the current transform mode immediately
    if (lastTransformMode === 'rotate') {
      control.setMode('rotate');
      control.showX = false;
      control.showY = true;
      control.showZ = false;
    } else {
      control.setMode('translate');
      control.showX = true;
      control.showY = false;
      control.showZ = true;
    }
    
    control.visible = false;
    control.enabled = false;

    control.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
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

                undoStack.push({
                    type: 'transform',
                    modelId: control.object.uuid,
                    oldPosition: instance.initialTransformState.position,
                    oldScale: instance.initialTransformState.scale,
                    oldRotation: instance.initialTransformState.rotation,
                    newPosition: currentTransformState.position,
                    newScale: currentTransformState.scale,
                    newRotation: currentTransformState.rotation
                });
                if (undoStack.length > MAX_HISTORY_STATES) {
                    undoStack.shift();
                }
                redoStack.length = 0; // Clear redo stack on new action
                console.log("Transform action recorded (from drop). Stack size:", undoStack.length);
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
      markSceneAsChanged();
      scheduleRender();
    });

    scene.add(control);
    controlsList.push(control);

    const uniqueName = modelName;
    const modelInstance = {
      model: model,
      control: control,
      name: uniqueName,
      scale: modelConfig.isImported ? 1 : finalScale // Scale multiplier for imported models, actual scale for existing models
    };

    modelInstances.push(modelInstance);
    updateSceneStats();
    selectModel(modelInstance);
    
    // Record 'add' action for undo
    undoStack.push({ type: 'add', modelId: model.uuid, modelConfig: modelConfig, initialPosition: model.position.clone(), initialRotation: model.rotation.clone(), initialScale: model.scale.clone() });
    if (undoStack.length > MAX_HISTORY_STATES) {
        undoStack.shift();
    }
    redoStack.length = 0; // Clear redo stack on new action
    console.log("Model added (from drop). Stack size:", undoStack.length);

    scheduleRender();
  }, undefined, (error) => {
    console.error('Error loading model:', error);
  });
});

  window.showSaveConfirmationDialog = function(actionName = 'continuing', onSave, onDiscard, onCancel) {
    const confirmed = confirm(`You have unsaved changes. Do you want to save before ${actionName}?`);

    if (confirmed) {
      if (typeof onSave === 'function') onSave();
    } else {
      const discard = confirm(`Are you sure you want to continue without saving?`);
      if (discard) {
        if (typeof onDiscard === 'function') onDiscard();
      } else {
        if (typeof onCancel === 'function') onCancel();
      }
    }
  };
  // Create combined control panel
  const controlPanel = document.createElement('div');
  controlPanel.className = 'control-panel';
  controlPanel.innerHTML = `
    <div class="control-panel-header">
      <div class="panel-brand">
        <img src="./static/img/Holcim Logo.png" alt="Logo" style="width: 20px; height: 20px; margin-right: 8px;">
        <span style="font-weight: 600; font-size: 13px; color: #1f2937;">Digital Twin</span>
      </div>
      
      <div class="toolbar-section">
        <div class="toolbar-group project-group">
          <button class="btn-toolbar" id="manageProjects" title="Manage Projects">
            <i class="fa-solid fa-folder-open"></i>
            <span>Projects</span>
          </button>
          <button class="btn-toolbar" id="saveProject" title="Save Current Project">
            <i class="fa-solid fa-save"></i>
            <span>Save</span>
          </button>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group view-group">
          <div class="dropdown-toolbar">
            <button class="btn-toolbar dropdown-toggle" id="resetViewDropdown" title="Camera Views">
              <i class="fa-solid fa-video"></i>
              <span>View</span>
              <i class="fa-solid fa-chevron-down" style="font-size: 10px; margin-left: 4px;"></i>
            </button>
            <div class="dropdown-menu" id="cameraDropdownMenu">
              <button class="dropdown-item" id="defaultViewBtn">
                <i class="fa-solid fa-home"></i> Default View
              </button>
              <button class="dropdown-item" id="topViewBtn">
                <i class="fa-solid fa-arrow-down"></i> Top View
              </button>
              <button class="dropdown-item" id="frontViewBtn">
                <i class="fa-solid fa-arrow-right"></i> Front View
              </button>
            </div>
          </div>
          <button class="btn-toolbar" id="screenshot" title="Take Screenshot">
            <i class="fa-solid fa-camera"></i>
            <span>Screenshot</span>
          </button>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group action-group">
          <button class="btn-toolbar" id="clearScene" title="Clear All Models">
            <i class="fa-solid fa-trash-alt"></i>
            <span>Clear</span>
          </button>
          <button class="btn-toolbar" id="toggleHelp" title="Show/Hide Help">
            <i class="fa-solid fa-question-circle"></i>
            <span>Help</span>
          </button>
        </div>
        
        <div class="toolbar-divider"></div>
        
        <div class="toolbar-group user-group">
          <button class="btn-toolbar btn-danger" id="logoutBtn" title="Sign Out" style="display: none;">
            <i class="fa-solid fa-sign-out-alt"></i>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
    
    <div class="help-content" id="helpContent" style="display: none;">
      <div class="help-grid">
        <div class="help-section">
          <h5><i class="fa-solid fa-mouse-pointer"></i> Selection</h5>
          <ul>
            <li><strong>Click</strong> model to select/deselect</li>
            <li><strong>Space/Esc</strong> to deselect all</li>
          </ul>
        </div>
        
        <div class="help-section">
          <h5><i class="fa-solid fa-arrows-alt"></i> Transform</h5>
          <ul>
            <li><strong>W</strong> Move mode</li>
            <li><strong>E</strong> Rotate mode</li>
            <li><strong>X/Y/Z</strong> Toggle axes</li>
            <li><strong>Shift</strong> Snap to grid</li>
          </ul>
        </div>
        
        <div class="help-section">
          <h5><i class="fa-solid fa-video"></i> Camera</h5>
          <ul>
            <li><strong>C</strong> Switch perspective/orthographic</li>
            <li><strong>Left Mouse</strong> Rotate view</li>
            <li><strong>Right Mouse</strong> Pan view</li>
            <li><strong>Scroll</strong> Zoom</li>
          </ul>
        </div>
        
        <div class="help-section"<h5><i class="fa-solid fa-keyboard"></i> Shortcuts</h5>
          <ul>
            <li><strong>Ctrl+S</strong> Save project</li>
            <li><strong>Ctrl+P</strong> Manage projects</li>
            <li><strong>Ctrl+Z</strong> Undo last action</li>
            <li><strong>Ctrl+Shift+Z</strong> Redo last action</li>
            <li><strong>+/-</strong> Resize gizmo</li>
          </ul>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(controlPanel);

  // Add toolbar event listeners
  document.getElementById('toggleHelp').addEventListener('click', () => {
    const helpContent = document.getElementById('helpContent');
    const toggleBtn = document.getElementById('toggleHelp');
    const isVisible = helpContent.style.display !== 'none';
    
    helpContent.style.display = isVisible ? 'none' : 'block';
    
    // Update button style to show active state
    if (isVisible) {
      // Help is being hidden - return to normal state
      toggleBtn.classList.remove('active');
    } else {
      // Help is being shown - add active state
      toggleBtn.classList.add('active');
    }
  });
  
  document.getElementById('manageProjects').addEventListener('click', () => {
    // Check for unsaved changes before proceeding
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
      window.showSaveConfirmationDialog(
        'opening projects manager',
        // On Save: save project then show projects
        () => {
          const trySaveProject = (attempts = 0) => {
            if (typeof window.saveProject === 'function') {
              window.saveProject().then(() => {
                // After saving, show projects modal
                setTimeout(() => {
                  if (typeof window.showProjectsModal === 'function') {
                    window.showProjectsModal();
                  }
                }, 100);
              });
            } else if (attempts < 10) {
              setTimeout(() => trySaveProject(attempts + 1), 100);
            } else {
              showNotification('Authentication system not loaded', 'error');
            }
          };
          trySaveProject();
        },
        // On Don't Save: show projects directly
        () => {
          const tryShowProjects = (attempts = 0) => {
            if (typeof window.showProjectsModal === 'function') {
              window.showProjectsModal();
            } else if (attempts < 10) {
              setTimeout(() => tryShowProjects(attempts + 1), 100);
            } else {
              showNotification('Authentication system not loaded', 'error');
            }
          };
          tryShowProjects();
        },
        // On Cancel: do nothing
        null
      );
    } else {
      // No unsaved changes, proceed normally
      const tryShowProjects = (attempts = 0) => {
        if (typeof window.showProjectsModal === 'function') {
          window.showProjectsModal();
        } else if (attempts < 10) {
          setTimeout(() => tryShowProjects(attempts + 1), 100);
        } else {
          showNotification('Authentication system not loaded', 'error');
        }
      };
      tryShowProjects();
    }
  });
  document.getElementById('saveProject').addEventListener('click', () => {
    // Wait for auth system to load with retry
    const trySaveProject = (attempts = 0) => {
      if (typeof window.saveProject === 'function') {
        window.saveProject();
      } else if (attempts < 10) {
        setTimeout(() => trySaveProject(attempts + 1), 100);
      } else {
        showNotification('Authentication system not loaded', 'error');
      }
    };
    trySaveProject();
  });
  document.getElementById('logoutBtn').addEventListener('click', () => {
    console.log('Logout button clicked');
    console.log('hasUnsavedChanges function exists:', typeof window.hasUnsavedChanges);
    console.log('hasUnsavedChanges value:', window.hasUnsavedChanges ? window.hasUnsavedChanges() : 'function not available');
    
    // Show visual notification that logout was clicked
    showNotification('Logout clicked - checking for unsaved changes...', 'info');
    
    // Check for unsaved changes before proceeding
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
      console.log('Showing save confirmation dialog');
      showNotification('Unsaved changes detected! Showing save dialog...', 'warning');
      window.showSaveConfirmationDialog(
        'logging out',
        // On Save: save project then logout
        () => {
          const trySaveProject = (attempts = 0) => {
            if (typeof window.saveProject === 'function') {
              window.saveProject().then(() => {
                // After saving, logout
                setTimeout(() => {
                  if (typeof window.logoutUser === 'function') {
                    window.logoutUser();
                  }
                }, 100);
              });
            } else if (attempts < 10) {
              setTimeout(() => trySaveProject(attempts + 1), 100);
            } else {
              showNotification('Authentication system not loaded', 'error');
            }
          };
          trySaveProject();
        },
        // On Don't Save: logout directly
        () => {
          const tryLogout = (attempts = 0) => {
            if (typeof window.logoutUser === 'function') {
              window.logoutUser();
            } else if (attempts < 10) {
              setTimeout(() => tryLogout(attempts + 1), 100);
            } else {
              showNotification('Authentication system not loaded', 'error');
            }
          };
          tryLogout();
        },
        // On Cancel: do nothing
        null
      );
    } else {
      console.log('No unsaved changes, proceeding with normal logout');
      showNotification('No unsaved changes - proceeding with logout', 'success');
      // No unsaved changes, proceed normally
      const tryLogout = (attempts = 0) => {
        if (typeof window.logoutUser === 'function') {
          window.logoutUser();
        } else if (attempts < 10) {
          setTimeout(() => tryLogout(attempts + 1), 100);
        } else {
          showNotification('Authentication system not loaded', 'error');
        }
      };
      tryLogout();
    }
  });
  document.getElementById('clearScene').addEventListener('click', clearScene);
  document.getElementById('screenshot').addEventListener('click', takeScreenshot);
  
  // Camera view buttons
  document.getElementById('defaultViewBtn').addEventListener('click', () => {
    // Call the reset to default view function
    resetToDefaultView();
  });

  document.getElementById('topViewBtn').addEventListener('click', () => {
    // Switch directly to orthographic camera for true top view
    currentCamera = cameraOrtho;
    //x=109.86, y=2828.36, z=1184.50
    // Position orthographic camera directly above the map center (reset position)
    currentCamera.position.set(0, 500, 0);  // Higher position to see the map properly
    currentCamera.lookAt(0, 0, 0);
    
    // Reset orthographic camera zoom to default
    const aspect = window.innerWidth / window.innerHeight;
    const mapRadius = 900; // Increased from 921.5 to show more of the map
    currentCamera.left = -mapRadius * aspect;
    currentCamera.right = mapRadius * aspect;
    currentCamera.top = mapRadius;
    currentCamera.bottom = -mapRadius;
    currentCamera.updateProjectionMatrix();
    
    // Update orbit controls to reset position and zoom
    orbit.object = currentCamera;
    orbit.target.set(0, 0, 0);
    orbit.update();
    
    // Update all transform controls
    controlsList.forEach(control => {
      control.camera = currentCamera;
    });
    
    // Update render mode display
    const renderModeElement = document.getElementById('renderMode');
    if (renderModeElement) {
      renderModeElement.textContent = 'Orthographic';
    }
    
    scheduleRender();
  });

  document.getElementById('frontViewBtn').addEventListener('click', () => {
    // Switch directly to perspective camera for front view
    currentCamera = cameraPersp;
    
    // Position camera for front view centered on map (reset position)
    currentCamera.position.set(0, 150, 1200);
    currentCamera.lookAt(0, 0, 0);
    
    // Update orbit controls to reset position and zoom
    orbit.object = currentCamera;
    orbit.target.set(0, 0, 0);
    orbit.update();
    
    // Update all transform controls
    controlsList.forEach(control => {
      control.camera = currentCamera;
    });
    
    // Update render mode display
    const renderModeElement = document.getElementById('renderMode');
    if (renderModeElement) {
      renderModeElement.textContent = 'Perspective';
    }
    
    scheduleRender();
  });

  // Dropdown functionality
  const dropdownToggle = document.getElementById('resetViewDropdown');
  const dropdownMenu = document.getElementById('cameraDropdownMenu');
  
  if (dropdownToggle && dropdownMenu) {
    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      dropdownMenu.classList.remove('show');
    });

    // Prevent dropdown from closing when clicking inside
    dropdownMenu.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
  
  // Initialize scene stats
  updateSceneStats();
  
  // Add render mode tracking
  const renderModeElement = document.getElementById('renderMode');
  if (renderModeElement) {
    renderModeElement.textContent = currentCamera.isPerspectiveCamera ? 'Perspective' : 'Orthographic';
  }

}

function loadUserLibrary(userId) {
  const dbRef = ref(getDatabase(), `users/${userId}/libraryModels`);
  onValue(dbRef, snapshot => {
    const data = snapshot.val();
    if (data) {
      Object.values(data).forEach(entry => {
        loadModelByURL(entry.url, model => {
          model.name = entry.name;
          model.userData.modelName = entry.name;
          scene.add(model);
          markSceneAsChanged();
        });
      });
    }
  });
}
async function handleUserModelImport(url, name) {
  const user = auth.currentUser;
  if (!user) return;

  const libRef = ref(getDatabase(), `users/${user.uid}/libraryModels`);

  try {
    const snapshot = await get(libRef);
    const existing = snapshot.val() || {};

    // Check for duplicate by name or URL
    const isDuplicate = Object.values(existing).some(model => model.url === url);


    if (isDuplicate) {
      showNotification(`Model "${name}" is already in your library.`, 'info');
      return;
    }

    // Add model to Firebase
    await push(libRef, { name, url });

    // Add to scene
    loadModelByURL(url, model => {
      model.name = name;
      model.userData.modelName = name;
      scene.add(model);
      markSceneAsChanged();
    });

    showNotification(`Model "${name}" added to your library.`, 'success');
  } catch (error) {
    console.error('Error checking/importing model:', error);
    showNotification('Error importing model.', 'error');
  }
}

// Update selected model controls in sidebar
// Full replacement of updateSelectedModelControls with added scale slider + undo
function updateSelectedModelControls(modelInstance) {
  const selectedControls = document.querySelector('.selected-model-controls');
  const noSelection = document.querySelector('.no-selection');

  if (!modelInstance) {
    if (modelInstances.length === 0) {
      selectedControls.style.display = 'none';
      noSelection.style.display = 'block';
      noSelection.innerHTML = `
        <i class="fa-solid fa-mouse-pointer"></i>
        <h4>No Model Selected</h4>
        <p>Click on a model in the scene to edit its properties</p>
      `;
      return;
    } else {
      selectedControls.style.display = 'block';
      noSelection.style.display = 'none';
      selectedControls.innerHTML = `
        <div class="scene-model-list">
          <h4 style="margin-bottom:10px;display:flex;align-items:center;gap:8px;">
            <i class="fa-solid fa-cube" style="font-size:18px;color:#000000;"></i> Models in Scene
          </h4>
          <div class="model-grid">
            ${modelInstances.map((instance, idx) => `
              <div class="model-item scene-model-list-item" data-model-idx="${idx}" draggable="false" style="cursor:pointer;">
                <div class="model-icon">
                  <i class="fa-solid fa-cube" style="font-size:18px;color:#fff;"></i>
                </div>
                <div class="model-info" style="display:flex;align-items:center;gap:8px;">
                  <span class="model-name">${instance.name}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      selectedControls.querySelectorAll('.scene-model-list-item').forEach(item => {
        item.addEventListener('click', function () {
          const idx = parseInt(this.getAttribute('data-model-idx'));
          if (!isNaN(idx) && modelInstances[idx]) {
            selectModel(modelInstances[idx]);
            focusOnSelectedModel(modelInstances[idx]);
          }
        });
      });
      return;
    }
  }

  noSelection.style.display = 'none';
  selectedControls.style.display = 'block';

  const model = modelInstance.model;
  const modelName = modelInstance.name;
  const baseName = modelName.replace(/ \d+$/, '');
  const allModels = { ...models, ...importedModels };
  const modelConfig = allModels[baseName] || allModels[modelName];

  selectedControls.innerHTML = `
    <div class="selected-model-header">
      <div class="model-preview">
        <i class="fa-solid fa-cube"></i>
      </div>
      <div class="model-meta">
        <h4>${modelName}</h4>
      </div>
    </div>

    <div class="control-section">
      <h5><i class="fa-solid fa-arrows-alt"></i> Transform</h5>
      <div class="transform-mode-controls">
        <div class="mode-buttons">
          <button class="btn-mode btn-transform ${lastTransformMode === 'transform' ? 'active' : ''}" id="transformBtn" onclick="setTransformMode()">
            <i class="fa-solid fa-arrows-alt"></i> Transform
          </button>
          <button class="btn-mode btn-rotate ${lastTransformMode === 'rotate' ? 'active' : ''}" id="rotateBtn" onclick="setRotateMode()">
            <i class="fa-solid fa-sync-alt"></i> Rotate
          </button>
        </div>
      </div>
      <div class="transform-controls">
        <div class="control-group">
          <label>Position</label>
          <div class="input-group">
            <input type="number" id="posX" value="${model.position.x.toFixed(2)}" step="5" placeholder="X">
            <input type="number" id="posZ" value="${model.position.z.toFixed(2)}" step="5" placeholder="Z">
          </div>
        </div>

        <div class="control-group">
          <label>Scale</label>
          <div class="input-group">
            <input type="number" id="scaleInput" value="${(modelInstance.scale || 1).toFixed(1)}" step="0.1" min="0.1" max="2">
            <input type="range" id="scaleSlider" min="0.1" max="2" step="0.1" value="${(modelInstance.scale || 1).toFixed(1)}">
            <span class="range-value">${(modelInstance.scale || 1).toFixed(1)}x</span>
          </div>
        </div>
      </div>
    </div>

    <div class="control-section">
      <h5><i class="fa-solid fa-wrench"></i> Actions</h5>
      <div class="action-buttons">
        <button class="btn-action btn-primary" onclick="focusOnModel()">
          <i class="fa-solid fa-crosshairs"></i> Focus
        </button>
        <button class="btn-action btn-secondary" onclick="duplicateModel()">
          <i class="fa-solid fa-copy"></i> Duplicate
        </button>
        <button class="btn-action btn-danger" onclick="deleteModel()">
          <i class="fa-solid fa-trash"></i> Delete
        </button>
      </div>
    </div>

    <div class="control-section">
      <h5><i class="fa-solid fa-layer-group"></i> Hierarchy</h5>
      <div class="hierarchy-info">
        <p><strong>Type:</strong> ${modelName}</p>
        <p><strong>Vertices:</strong> <span id="vertexCount">Calculating...</span></p>
        <p><strong>Materials:</strong> <span id="materialCount">Calculating...</span></p>
        ${modelConfig.isImported && modelConfig.recommendedScale ? `<p><strong>Recommended Scale:</strong> ${modelConfig.recommendedScale.toFixed(2)}x</p>` : ''}
      </div>
    </div>
  `;

  modelInstance.initialTransformState = {
    position: model.position.clone(),
    scale: model.scale.clone(),
    rotation: model.rotation.clone()
  };

  const scaleInput = document.getElementById('scaleInput');
  const scaleSlider = document.getElementById('scaleSlider');
  const scaleText = selectedControls.querySelector('.range-value');

  function updateScale(scaleValue, pushUndo = false) {
    const safeValue = isNaN(scaleValue) ? 1 : scaleValue;
    const clamped = Math.max(0.1, Math.min(2, safeValue));
    const applied = applySafeScale(model, clamped, modelConfig);
    modelInstance.scale = applied;
    scaleInput.value = applied.toFixed(1);
    scaleSlider.value = applied.toFixed(1);
    scaleText.textContent = `${applied.toFixed(1)}x`;

    if (pushUndo) {
      undoStack.push({
        type: 'transform',
        modelId: model.uuid,
        oldScale: modelInstance.initialTransformState.scale.clone(),
        newScale: model.scale.clone(),
        oldPosition: modelInstance.initialTransformState.position.clone(),
        newPosition: model.position.clone(),
        oldRotation: modelInstance.initialTransformState.rotation.clone(),
        newRotation: model.rotation.clone()
      });
      if (undoStack.length > MAX_HISTORY_STATES) undoStack.shift();
      redoStack.length = 0;
      modelInstance.initialTransformState = null;
    }

    markSceneAsChanged();
    scheduleRender();
  }

  scaleInput.addEventListener('input', () => updateScale(parseFloat(scaleInput.value)));
  scaleSlider.addEventListener('input', () => updateScale(parseFloat(scaleSlider.value)));
  scaleInput.addEventListener('change', () => updateScale(parseFloat(scaleInput.value), true));
  scaleSlider.addEventListener('change', () => updateScale(parseFloat(scaleSlider.value), true));

  updateModelStatistics(model);
  setupSelectedModelEventListeners(modelInstance);
}




// Setup event listeners for selected model controls
function setupSelectedModelEventListeners(modelInstance) {
  const model = modelInstance.model;
  const modelName = modelInstance.name;
  const allModels = { ...models, ...importedModels };
  const baseName = modelName.replace(/ \d+$/, ''); // Remove number suffix to get base name
  const modelConfig = allModels[baseName] || allModels[modelName];
  
  // --- START: UNDO/REDO FIX FOR NUMERICAL INPUTS ---
  ['posX', 'posY', 'posZ'].forEach((id, index) => {
    const input = document.getElementById(id);
    if (input) {
      let initialInputState = null; // Local variable for each input

      input.addEventListener('focus', () => {
        // Capture the state when the input field gains focus
        initialInputState = {
          position: model.position.clone(),
          scale: model.scale.clone(), // Include scale and rotation for a comprehensive transform state
          rotation: model.rotation.clone()
        };
      });

      input.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (isNaN(value)) return; // Don't update if input is not a valid number

        const axis = ['x', 'y', 'z'][index];
        model.position[axis] = value;
        markSceneAsChanged(); // Mark scene as changed on manual input
        scheduleRender();
      });

      input.addEventListener('blur', () => {
        // When the input field loses focus, record the action if changed
        if (!initialInputState) return; // Exit if no initial state was captured

        const currentTransformState = {
          position: model.position.clone(),
          scale: model.scale.clone(),
          rotation: model.rotation.clone()
        };

        // Check if position (or any other relevant transform property) has changed
        if (!initialInputState.position.equals(currentTransformState.position) ||
            !initialInputState.scale.equals(currentTransformState.scale) ||
            !initialInputState.rotation.equals(currentTransformState.rotation)) {
          
          undoStack.push({
            type: 'transform',
            modelId: model.uuid,
            oldPosition: initialInputState.position,
            oldScale: initialInputState.scale,
            oldRotation: initialInputState.rotation,
            newPosition: currentTransformState.position,
            newScale: currentTransformState.scale,
            newRotation: currentTransformState.rotation
          });
          if (undoStack.length > MAX_HISTORY_STATES) {
            undoStack.shift();
          }
          redoStack.length = 0; // Clear redo stack on new action
          console.log("Numerical input transform action recorded. Stack size:", undoStack.length);
          markSceneAsChanged(); // Mark scene as changed when recording undo action
        }
        initialInputState = null; // Reset for the next interaction
      });
    }
  });
  // --- END: UNDO/REDO FIX FOR NUMERICAL INPUTS ---
  
  // --- START: UNDO/REDO FIX FOR SCALE SLIDER ---
  const scaleSlider = document.getElementById('scaleSlider');
  const rangeValue = document.querySelector('.range-value');
  
  if (scaleSlider) {
    let initialSliderState = null;

    // 1. Capture the initial state when the user starts interacting with the slider
    scaleSlider.addEventListener('mousedown', () => {
        initialSliderState = {
            position: model.position.clone(),
            scale: model.scale.clone(),
            rotation: model.rotation.clone()
        };
    });

    // 2. Handle the live scaling as the user drags the slider
    scaleSlider.addEventListener('input', (e) => {
        const scaleMultiplier = parseFloat(e.target.value);
        const validScale = getValidScale(scaleMultiplier, 0.1, 2);
        
        if (modelConfig.isImported) {
            const baseScale = modelConfig.scale || 1;
            const actualScale = baseScale * validScale;
            model.scale.set(actualScale, actualScale, actualScale);
            positionModelOnSurface(model);
        } else {
            applySafeScale(model, validScale, modelConfig);
        }
        
        modelInstance.scale = validScale;
        
        if (rangeValue) {
            rangeValue.textContent = validScale.toFixed(1) + 'x';
        }
        
        const posYInput = document.getElementById('posY');
        if (posYInput) {
            posYInput.value = model.position.y.toFixed(2);
        }
        
        markSceneAsChanged();
        scheduleRender();
    });

    // 3. When the user releases the slider, record the final state for undo/redo
    scaleSlider.addEventListener('change', () => {
        if (!initialSliderState) return; // Exit if we didn't capture an initial state

        const finalState = {
            position: model.position.clone(),
            scale: model.scale.clone(),
            rotation: model.rotation.clone()
        };

        // Only push to the undo stack if the scale has actually changed
        if (!initialSliderState.scale.equals(finalState.scale)) {
            undoStack.push({
                type: 'transform',
                modelId: model.uuid,
                oldPosition: initialSliderState.position,
                oldScale: initialSliderState.scale,
                oldRotation: initialSliderState.rotation,
                newPosition: finalState.position,
                newScale: finalState.scale,
                newRotation: finalState.rotation
            });

            if (undoStack.length > MAX_HISTORY_STATES) {
                undoStack.shift(); // Keep the stack size manageable
            }
            redoStack.length = 0; // A new action clears the redo stack
            console.log("Scale action recorded. Stack size:", undoStack.length);
            markSceneAsChanged(); // Mark scene as changed when recording undo action
        }

        initialSliderState = null; // Reset for the next interaction
    });
  }
  // --- END: UNDO/REDO FIX FOR SCALE SLIDER ---
  
  // Initialize transform mode buttons - use the last used mode
  setTimeout(() => {
    // Apply the last used transform mode to the control
    if (lastTransformMode === 'rotate') {
      if (selectedControl) {
        selectedControl.setMode('rotate');
        selectedControl.showX = false;
        selectedControl.showY = true;
        selectedControl.showZ = false;
      }
    } else {
      if (selectedControl) {
        selectedControl.setMode('translate');
        selectedControl.showX = true;
        selectedControl.showY = false;
        selectedControl.showZ = true;
      }
    }
    
    // Update UI button states to reflect the last used mode
    updateTransformModeButtons(lastTransformMode);
  }, 100);
  
  // Global action functions
  window.focusOnModel = () => focusOnSelectedModel(modelInstance);
  window.duplicateModel = () => duplicateSelectedModel(modelInstance);
  window.deleteModel = () => deleteSelectedModel(modelInstance);
  
  // Transform mode functions
  window.setTransformMode = () => setTransformMode();
  window.setRotateMode = () => setRotateMode();
}

// Update model statistics
function updateModelStatistics(model) {
  let vertexCount = 0;
  let materialCount = 0;
  
  model.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) {
        vertexCount += child.geometry.attributes.position?.count || 0;
      }
      if (child.material) {
        materialCount++;
      }
    }
  });
  
  const vertexElement = document.getElementById('vertexCount');
  const materialElement = document.getElementById('materialCount');
  
  if (vertexElement) vertexElement.textContent = vertexCount.toLocaleString();
  if (materialElement) materialElement.textContent = materialCount.toString();
}

// Focus on selected model
function focusOnSelectedModel(modelInstance) {
  const model = modelInstance.model;
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const distance = Math.max(size.x, size.y, size.z) * 2.5;
  
  // Create smooth camera transition
  const startPos = currentCamera.position.clone();
  const endPos = new THREE.Vector3(
    center.x + distance * 0.8,
    center.y + distance * 0.6,
    center.z + distance * 0.8
  );
  
  // Animate camera position
  const duration = 1000;
  const startTime = Date.now();
  
  function animateCamera() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Smooth easing function
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    
    currentCamera.position.lerpVectors(startPos, endPos, easeProgress);
    orbit.target.lerp(center, easeProgress);
    
    scheduleRender();
    
    if (progress < 1) {
      requestAnimationFrame(animateCamera);
    } else {
      orbit.update();
    }
  }
  
  animateCamera();
}

// Duplicate selected model
function duplicateSelectedModel(modelInstance) {
  const originalModel = modelInstance.model;
  // Get the base name (strip any trailing number)
  const baseName = modelInstance.name.replace(/ \d+$/, '');
  const allModels = { ...models, ...importedModels };
  const modelConfig = allModels[baseName] || allModels[modelInstance.name];

  // Count existing models with the same base name
  const sameNameCount = modelInstances.filter(inst => inst.name === baseName || inst.name.startsWith(baseName + ' ')).length;
  // Assign unique name
  const uniqueName = sameNameCount === 0 ? baseName : baseName + ' ' + sameNameCount;

  // Load the model again
  const loader = new GLTFLoader();
  loader.load(modelConfig.url, (gltf) => {
    const newModel = gltf.scene;

    // Copy position from original (X and Z only), smaller offset
    newModel.position.x = originalModel.position.x + 30; // Offset X
    newModel.position.z = originalModel.position.z + 30; // Offset Z
    newModel.position.y = 0; // Set Y to 0 initially

    // Copy rotation
    newModel.rotation.copy(originalModel.rotation);

    // Get the current scale multiplier from the original model instance
    const currentScaleMultiplier = modelInstance.scale || 1;

    // Apply the same scaling logic as the drop handler
    let actualScale;
    if (modelConfig.isImported) {
      // For imported models, apply the calculated scale directly
      actualScale = modelConfig.scale || 1;
      actualScale = actualScale * currentScaleMultiplier;
      newModel.scale.set(actualScale, actualScale, actualScale);
      positionModelOnSurface(newModel);
    } else {
      // For existing models, use the scaling function
      actualScale = applySafeScale(newModel, currentScaleMultiplier, modelConfig);
    }

    // Enable shadows
    newModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(newModel);

    // Create transform controls
    const control = new TransformControls(currentCamera, renderer.domElement);
    control.setSpace("world");
    control.attach(newModel);
    control.setSize(0.8);
    control.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
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

                undoStack.push({
                    type: 'transform',
                    modelId: control.object.uuid,
                    oldPosition: instance.initialTransformState.position,
                    oldScale: instance.initialTransformState.scale,
                    oldRotation: instance.initialTransformState.rotation,
                    newPosition: currentTransformState.position,
                    newScale: currentTransformState.scale,
                    newRotation: currentTransformState.rotation
                });
                if (undoStack.length > MAX_HISTORY_STATES) {
                    undoStack.shift();
                }
                redoStack.length = 0; // Clear redo stack on new action
                console.log("Transform action recorded (from duplicate). Stack size:", undoStack.length);
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
      markSceneAsChanged();
      scheduleRender();
    });
    scene.add(control);
    controlsList.push(control);
    control.setMode('translate');
    control.showX = true;
    control.showY = false;
    control.showZ = true;
    control.visible = false;
    control.enabled = false;

    // Track the model instance
    const newModelInstance = {
      model: newModel,
      control: control,
      name: uniqueName,
      scale: currentScaleMultiplier // Store the scale in the new instance
    };
    modelInstances.push(newModelInstance);
    updateSceneStats();
    selectModel(modelInstance);
    
    // Record 'add' action for undo
    undoStack.push({ type: 'add', modelId: newModel.uuid, modelConfig: modelConfig, initialPosition: newModel.position.clone(), initialRotation: newModel.rotation.clone(), initialScale: newModel.scale.clone() });
    if (undoStack.length > MAX_HISTORY_STATES) {
        undoStack.shift();
    }
    redoStack.length = 0; // Clear redo stack on new action
    console.log("Model duplicated (add action recorded). Stack size:", undoStack.length);

    scheduleRender();
    // Removed window.saveStateToHistory(); as it's not part of this undo system
  }, undefined, (error) => {
    console.error('Error loading model:', error);
  });
}

// Delete selected model
function deleteSelectedModel(modelInstance) {
  // Custom modal confirmation dialog
  const existingModal = document.getElementById('delete-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="background:#fff;padding:32px 28px 24px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:320px;max-width:90vw;text-align:center;">
      <div style="font-size:32px;color:#e03131;margin-bottom:12px;"><i class='fa-solid fa-trash'></i></div>
      <h3 style="margin:0 0 8px 0;font-size:20px;">Delete Model from Scene?</h3>
      <div style="color:#555;font-size:15px;margin-bottom:18px;">Are you sure you want to delete <b>${modelInstance.name}</b> from the scene? The model will remain in the library for re-use.</div>
      <div style="display:flex;justify-content:center;gap:16px;">
        <button id="delete-confirm-btn" style="background:#e03131;color:#fff;padding:8px 22px;border:none;border-radius:6px;font-size:15px;cursor:pointer;">Delete from Scene</button>
        <button id="delete-cancel-btn" style="background:#f1f3f5;color:#222;padding:8px 22px;border:none;border-radius:6px;font-size:15px;cursor:pointer;">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('delete-cancel-btn').onclick = () => {
    modal.remove();
  };
  document.getElementById('delete-confirm-btn').onclick = () => {
    modal.remove();
    
    // Record 'delete' action for undo before removing
    undoStack.push({ 
      type: 'delete', 
      modelId: modelInstance.model.uuid, 
      modelConfig: modelInstance.modelConfig, // Store config to re-load if needed
      position: modelInstance.model.position.clone(),
      rotation: modelInstance.model.rotation.clone(),
      scale: modelInstance.model.scale.clone(),
      name: modelInstance.name
    });
    if (undoStack.length > MAX_HISTORY_STATES) {
        undoStack.shift();
    }
    redoStack.length = 0; // Clear redo stack on new action
    console.log("Model delete action recorded. Stack size:", undoStack.length);

    scene.remove(modelInstance.model);
    scene.remove(modelInstance.control);
    // Remove from instances array
    const index = modelInstances.indexOf(modelInstance);
    if (index > -1) {
      modelInstances.splice(index, 1);
    }
    // Remove from controls list
    const controlIndex = controlsList.indexOf(modelInstance.control);
    if (controlIndex > -1) {
      controlsList.splice(controlIndex, 1);
    }
    // Update scene stats
    updateSceneStats();
    // Deselect all models
    deselectAllModels();
    
    // Mark scene as changed
    // (REMOVED) markSceneAsChanged();
    
    scheduleRender();
    showNotification('Model removed from scene! You can drag it back from the library.', 'success');
  };
}

// Transform mode control functions
function setTransformMode() {
  if (selectedControl) {
    selectedControl.setMode('translate');
    selectedControl.showX = true;
    selectedControl.showY = false;
    selectedControl.showZ = true;
    
    // Store the last used mode
    lastTransformMode = 'transform';
    
    // Update UI button states
    updateTransformModeButtons('transform');
    
    showNotification('Transform mode activated', 'info');
  }
}

function setRotateMode() {
  if (selectedControl) {
    selectedControl.setMode('rotate');
    selectedControl.showX = false;
    selectedControl.showY = true;
    selectedControl.showZ = false;
    
    // Store the last used mode
    lastTransformMode = 'rotate';
    
    // Update UI button states
    updateTransformModeButtons('rotate');
    
    showNotification('Rotate mode activated', 'info');
  }
}

// Update transform mode button states
function updateTransformModeButtons(activeMode) {
  const transformBtn = document.getElementById('transformBtn');
  const rotateBtn = document.getElementById('rotateBtn');
  
  if (transformBtn && rotateBtn) {
    // Remove active class from both buttons
    transformBtn.classList.remove('active');
    rotateBtn.classList.remove('active');
    
    // Add active class to the selected button
    if (activeMode === 'transform') {
      transformBtn.classList.add('active');
    } else if (activeMode === 'rotate') {
      rotateBtn.classList.add('active');
    }
  }
}

// Setup drag and drop for model library
function setupModelDragAndDrop() {
  const modelItems = document.querySelectorAll('.model-item');
  
  console.log(`Setting up drag and drop for ${modelItems.length} model items`);
  
  modelItems.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      console.log('Drag started for:', e.target);
      
      // Prevent text selection during drag
      document.body.classList.add('dragging');
      
      // Get the model name from the dragged element or its parent
      let modelName = e.target.getAttribute('data-model');
      if (!modelName) {
        // Try to get from parent element
        const parent = e.target.closest('.model-item');
        if (parent) {
          modelName = parent.getAttribute('data-model');
        }
      }
      
      console.log('Model name:', modelName);
      
      const allModels = { ...models, ...importedModels };
      const modelConfig = allModels[modelName];
      
      if (modelConfig) {
        e.dataTransfer.setData('model-name', modelName);
        e.dataTransfer.setData('model-url', modelConfig.url);
        e.dataTransfer.setData('is-imported', modelConfig.isImported ? 'true' : 'false');
        e.dataTransfer.effectAllowed = 'copy';
        
        console.log('Drag data set for:', modelName, modelConfig.url);
        
        // Add visual feedback
        e.target.style.opacity = '0.5';
      } else {
        console.error('Model config not found for:', modelName);
      }
    });
    
    item.addEventListener('dragend', (e) => {
      // Reset visual feedback
      e.target.style.opacity = '1';
      
      // Re-enable text selection
      document.body.classList.remove('dragging');
    });
    
    // Ensure item is draggable
    item.draggable = true;
    
    // Add some visual indication that item is draggable
    item.style.cursor = 'grab';
  });
}

// Update the library grid to include imported models
function updateLibraryGrid() {
  const libraryGrid = document.querySelector('#library-tab .model-grid');
  if (!libraryGrid) return;
  const allModels = { ...models, ...importedModels };
  libraryGrid.innerHTML = Object.keys(allModels).map(name => {
    const model = allModels[name];
    return `
      <div class="model-item" draggable="true" data-model="${name}" style="position: relative;">
        <div class="model-icon">
          <i class="fa-solid fa-cube"></i>
        </div>
        <div class="model-info">
          <span class="model-name">${name}</span>
          ${model.isImported && model.recommendedScale ? `
            <span class="model-scale-info" style="font-size: 11px; color: #666; display: block;">
              Default: ${model.recommendedScale.toFixed(2)}x
            </span>
          ` : ''}
        </div>
        ${model.isImported ? `
          <button class="delete-from-library-btn" onclick="deleteFromLibrary('${name}')" title="Delete from library">
            <i class="fa-solid fa-times"></i>
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
  setupModelDragAndDrop();
}

// Delete model from library (completely remove from project)
function deleteFromLibrary(modelName) {
  // Custom modal confirmation dialog
  const existingModal = document.getElementById('delete-library-modal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-library-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';
  modal.innerHTML = `
    <div style="background:#fff;padding:32px 28px 24px 28px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:320px;max-width:90vw;text-align:center;">
      <div style="font-size:32px;color:#e03131;margin-bottom:12px;"><i class='fa-solid fa-trash'></i></div>
      <h3 style="margin:0 0 8px 0;font-size:20px;">Delete from Library?</h3>
      <div style="color:#555;font-size:15px;margin-bottom:18px;">Are you sure you want to delete <b>${modelName}</b> from the library? This will also remove all instances from the scene and cannot be undone.</div>
      <div style="display:flex;justify-content:center;gap:16px;">
        <button id="delete-library-confirm-btn" style="background:#e03131;color:#fff;padding:8px 22px;border:none;border-radius:6px;font-size:15px;cursor:pointer;">Delete</button>
        <button id="delete-library-cancel-btn" style="background:#f1f3f5;color:#222;padding:8px 22px;border:none;border-radius:6px;font-size:15px;cursor:pointer;">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('delete-library-cancel-btn').onclick = () => {
    modal.remove();
  };
  document.getElementById('delete-library-confirm-btn').onclick = () => {
    modal.remove();
    
    // Remove all instances of this model from the scene
    const instancesToRemove = modelInstances.filter(instance => 
      instance.name === modelName || instance.name.startsWith(modelName + ' ')
    );
    
    instancesToRemove.forEach(instance => {
      scene.remove(instance.model);
      scene.remove(instance.control);
      
      // Remove from instances array
      const index = modelInstances.indexOf(instance);
      if (index > -1) {
        modelInstances.splice(index, 1);
      }
      
      // Remove from controls list
      const controlIndex = controlsList.indexOf(instance.control);
      if (controlIndex > -1) {
        controlsList.splice(controlIndex, 1);
      }
    });
    
    // Remove from imported models
    delete importedModels[modelName];
    
    // Update library grid
    updateLibraryGrid();
    
    // Update scene stats
    updateSceneStats();
    
    // Deselect all models
    deselectAllModels();
    
    scheduleRender();
    showNotification('Model deleted from library!', 'success');
    // Ask if user wants to restore cached scene

  };
}

// --- Undo/Redo Functions ---

/**
 * Undoes the last action recorded in the undoStack.
 * Supports 'add', 'delete', and 'transform' actions.
 */
function undo() {
    if (undoStack.length === 0) {
        console.log("Nothing to undo.");
        showNotification("Nothing to undo!", "info");
        return;
    }

    const action = undoStack.pop(); // Get the last action
    redoStack.push(action); // Push to redo stack

    console.log("Undoing action:", action.type, action);

    if (action.type === 'add' && !action.preventRemoveOnUndo) {
        // Find the model instance by UUID
        const modelInstance = modelInstances.find(inst => inst.model.uuid === action.modelId);
        if (modelInstance) {
            scene.remove(modelInstance.model);
            scene.remove(modelInstance.control);
            // Remove from instances array
            modelInstances.splice(modelInstances.indexOf(modelInstance), 1);
            // Remove from controls list
            controlsList.splice(controlsList.indexOf(modelInstance.control), 1);
            
            // --- FIX STARTS HERE ---
            if (selectedModel === modelInstance) {
                deselectAllModels(); // Deselect if the undone model was selected, this also updates the UI.
            } else {
                // If another model (or no model) was selected, we still need to refresh the sidebar
                // to show the updated list of models in the scene.
                updateSelectedModelControls(selectedModel);
            }
            // --- FIX ENDS HERE ---

            showNotification(`Undid: Added "${modelInstance.name}"`, "success");
        } else {
            console.warn("Model not found for 'add' undo:", action.modelId);
            showNotification("Error undoing 'add' action.", "error");
        }
    } else if (action.type === 'delete') {
        // Re-add the model to the scene
        const loader = new GLTFLoader();
        loader.load(action.modelConfig.url, (gltf) => {
            const model = gltf.scene;
            model.position.copy(action.position);
            model.rotation.copy(action.rotation);
            model.scale.copy(action.scale);
            model.name = action.name; // Restore original name

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            scene.add(model);

            const control = new TransformControls(currentCamera, renderer.domElement);
            control.setSpace("world");
            control.attach(model);
            control.setSize(0.8);
            control.visible = false;
            control.enabled = false;

            // Re-attach dragging-changed listener for re-added model
            control.addEventListener('dragging-changed', (event) => {
                orbit.enabled = !event.value;
                if (event.value === false && control.object) { // Dragging ended
                    const currentTransformState = {
                        position: control.object.position.clone(),
                        scale: control.object.scale.clone(),
                        rotation: control.object.rotation.clone()
                    };
                    const instance = modelInstances.find(inst => inst.model === control.object);
                    if (instance && instance.initialTransformState) {
                        if (!instance.initialTransformState.position.equals(currentTransformState.position) ||
                            !instance.initialTransformState.scale.equals(currentTransformState.scale) ||
                            !instance.initialTransformState.rotation.equals(currentTransformState.rotation)) {
                            undoStack.push({
                                type: 'transform',
                                modelId: control.object.uuid,
                                oldPosition: instance.initialTransformState.position,
                                oldScale: instance.initialTransformState.scale,
                                oldRotation: instance.initialTransformState.rotation,
                                newPosition: currentTransformState.position,
                                newScale: currentTransformState.scale,
                                newRotation: currentTransformState.rotation,
                                preventRemoveOnUndo: true
                            });
                            if (undoStack.length > MAX_HISTORY_STATES) { undoStack.shift(); }
                            redoStack.length = 0;
                        }
                        instance.initialTransformState = null;
                    }
                } else if (event.value === true && control.object) {
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
                markSceneAsChanged();
                scheduleRender();
            });

            scene.add(control);
            controlsList.push(control);

            const newModelInstance = {
                model: model,
                control: control,
                name: action.name,
                scale: action.scale.x // Assuming uniform scale
            };
            modelInstances.push(newModelInstance);
            updateSceneStats();
            selectModel(newModelInstance); // Select the re-added model
            showNotification(`Undid: Deleted "${action.name}"`, "success");
            scheduleRender();
        }, undefined, (error) => {
            console.error('Error re-loading model for undo:', error);
            showNotification("Error re-adding model on undo.", "error");
        });

    } else if (action.type === 'transform') {
    const model = scene.getObjectByProperty('uuid', action.modelId);
    if (model) {
        // Revert to the old state (before the transformation)
        model.position.copy(action.oldPosition);
        model.rotation.copy(action.oldRotation);
        model.scale.copy(action.oldScale);
        
        // Update the model instance scale property to match the UI slider
        const modelInstance = modelInstances.find(inst => inst.model.uuid === action.modelId);
        if (modelInstance && action.oldScale) {
            const allModels = { ...models, ...importedModels };
            const baseName = modelInstance.name.replace(/ \d+$/, '');
            const modelConfig = allModels[baseName] || allModels[modelInstance.name];
            
            if (modelConfig && modelConfig.isImported) {
                // For imported models: actualScale = baseScale * scaleMultiplier
                const baseScale = modelConfig.scale || 1;
                const scaleMultiplier = action.oldScale.x / baseScale;
                modelInstance.scale = scaleMultiplier;
            } else if (modelConfig && modelConfig.realDimensions && modelConfig.glbDimensions) {
                // For regular models with real dimensions: actualScale = (realDim/glbDim) * scaleMultiplier
                const baseScaleX = modelConfig.realDimensions.width / modelConfig.glbDimensions.width;
                const scaleMultiplier = action.oldScale.x / baseScaleX;
                modelInstance.scale = scaleMultiplier;
            } else {
                // Fallback for models without configuration
                modelInstance.scale = action.oldScale.x;
            }
            
            // Update the UI to reflect the scale change if this model is selected
            if (selectedModel === modelInstance) {
                updateSelectedModelControls(selectedModel);
            }
        }
        
        showNotification(`Undid: Transform on "${model.name || model.uuid}"`, "success");
    } else {
        console.warn("Model not found for 'transform' undo:", action.modelId);
        showNotification("Error undoing 'transform' action.", "error");
    }
}
    updateSceneStats();
    scheduleRender();
    render();
}

/**
 * Re-applies the last action undone.
 * Currently primarily supports redoing 'transform' actions.
 */
function redo() {
    if (redoStack.length === 0) {
        console.log("Nothing to redo.");
        showNotification("Nothing to redo!", "info");
        return;
    }

    const action = redoStack.pop();
    undoStack.push(action); // Push back to undo stack

    console.log("Redoing action:", action.type, action);

    if (action.type === 'add') {
        // Re-add the model to the scene
        const loader = new GLTFLoader();
        loader.load(action.modelConfig.url, (gltf) => {
            const model = gltf.scene;
            model.position.copy(action.initialPosition);
            model.rotation.copy(action.initialRotation);
            model.scale.copy(action.initialScale);
            model.name = action.name; // Restore original name

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            scene.add(model);

            const control = new TransformControls(currentCamera, renderer.domElement);
            control.setSpace("world");
            control.attach(model);
            control.setSize(0.8);
            control.visible = false;
            control.enabled = false;

            // Re-attach dragging-changed listener for re-added model
            control.addEventListener('dragging-changed', (event) => {
                orbit.enabled = !event.value;
                if (event.value === false && control.object) { // Dragging ended
                    const currentTransformState = {
                        position: control.object.position.clone(),
                        scale: control.object.scale.clone(),
                        rotation: control.object.rotation.clone()
                    };
                    const instance = modelInstances.find(inst => inst.model === control.object);
                    if (instance && instance.initialTransformState) {
                        if (!instance.initialTransformState.position.equals(currentTransformState.position) ||
                            !instance.initialTransformState.scale.equals(currentTransformState.scale) ||
                            !instance.initialTransformState.rotation.equals(currentTransformState.rotation)) {
                            undoStack.push({
                                type: 'transform',
                                modelId: control.object.uuid,
                                oldPosition: instance.initialTransformState.position,
                                oldScale: instance.initialTransformState.scale,
                                oldRotation: instance.initialTransformState.rotation,
                                newPosition: currentTransformState.position,
                                newScale: currentTransformState.scale,
                                newRotation: currentTransformState.rotation
                            });
                            if (undoStack.length > MAX_HISTORY_STATES) { undoStack.shift(); }
                            redoStack.length = 0;
                        }
                        instance.initialTransformState = null;
                    }
                } else if (event.value === true && control.object) {
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
                markSceneAsChanged();
                scheduleRender();
            });

            scene.add(control);
            controlsList.push(control);

            const newModelInstance = {
                model: model,
                control: control,
                name: action.name,
                scale: action.initialScale.x // Assuming uniform scale
            };
            modelInstances.push(newModelInstance);
            updateSceneStats();
            selectModel(newModelInstance); // Select the re-added model
            showNotification(`Redid: Added "${action.name}"`, "success");
            scheduleRender();
        }, undefined, (error) => {
            console.error('Error re-loading model for redo:', error);
            showNotification("Error re-adding model on redo.", "error");
        });
    } else if (action.type === 'delete') {
        // Remove the model from the scene (reverse of undoing 'delete')
        const modelInstance = modelInstances.find(inst => inst.model.uuid === action.modelId);
        if (modelInstance) {
            scene.remove(modelInstance.model);
            scene.remove(modelInstance.control);
            modelInstances.splice(modelInstances.indexOf(modelInstance), 1);
            controlsList.splice(controlsList.indexOf(modelInstance.control), 1);
            
            // --- FIX STARTS HERE ---
            if (selectedModel === modelInstance) {
                deselectAllModels();
            } else {
                // Refresh the sidebar to reflect the removal of the model from the list.
                updateSelectedModelControls(selectedModel);
            }
            // --- FIX ENDS HERE ---

            showNotification(`Redid: Deleted "${modelInstance.name}"`, "success");
        } else {
            console.warn("Model not found for 'delete' redo:", action.modelId);
            showNotification("Error redoing 'delete' action.", "error");
        }
    } else if (action.type === 'transform') {
        const model = scene.getObjectByProperty('uuid', action.modelId);
        if (model) {
            // Re-apply the new state (after the transformation)
            model.position.copy(action.newPosition);
            model.scale.copy(action.newScale);
            model.rotation.copy(action.newRotation);
            
            // Update the modelInstance.scale property to match the new scale
            const modelInstance = modelInstances.find(inst => inst.model.uuid === action.modelId);
            if (modelInstance) {
                // Calculate the scale multiplier from the actual model scale
                const baseName = modelInstance.name.replace(/ \d+$/, '');
                const allModels = { ...models, ...importedModels };
                const modelConfig = allModels[baseName] || allModels[modelInstance.name];
                
                if (modelConfig && modelConfig.isImported) {
                    // For imported models, calculate the multiplier
                    const baseScale = modelConfig.scale || 1;
                    modelInstance.scale = action.newScale.x / baseScale;
                } else {
                    // For regular models, the scale is the multiplier
                    modelInstance.scale = action.newScale.x;
                }
            }
            
            // --- FIX STARTS HERE ---
            if (selectedModel && selectedModel.model.uuid === action.modelId) {
                updateSelectedModelControls(selectedModel); // Refresh UI for selected model
            }
            // --- FIX ENDS HERE ---
            showNotification(`Redid: Transform on "${model.name || model.uuid}"`, "success");
        } else {
            console.warn("Model not found for 'transform' redo:", action.modelId);
            showNotification("Error redoing 'transform' action.", "error");
        }
    }
    updateSceneStats();
    scheduleRender();
}

window.deleteFromLibrary = deleteFromLibrary;
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Export variables and functions for use by auth.js
window.scene = scene;
window.renderer = renderer;
window.currentCamera = currentCamera;
window.orbit = orbit;
window.modelInstances = modelInstances;
window.controlsList = controlsList;
window.updateSceneStats = updateSceneStats;
window.scheduleRender = scheduleRender;
window.clearScene = clearScene;
window.deselectAllModels = deselectAllModels;
window.models = models;
window.importedModels = importedModels;
window.applySafeScale = applySafeScale;
window.positionModelOnSurface = positionModelOnSurface;
window.GLTFLoader = GLTFLoader;
window.TransformControls = TransformControls;
window.THREE = THREE;
window.hemiLight = hemiLight;
window.dirLight = dirLight;
window.showProjectsModal = window.showProjectsModal || null; // Will be set by auth.js
window.loadModelFromData = window.loadModelFromData || null; // Will be set by auth.js if needed

// Function to update project name display
window.updateProjectDisplay = function(projectName) {
  const currentProjectDiv = document.getElementById('currentProject');
  const projectNameSpan = document.getElementById('projectName');
  
  if (currentProjectDiv && projectNameSpan) {
    if (projectName) {
      currentProjectDiv.style.display = 'block';
      projectNameSpan.textContent = projectName;
    } else {
      currentProjectDiv.style.display = 'none';
      projectNameSpan.textContent = 'No project loaded';
    }
  }
  // Update the display to reflect any unsaved changes
  updateProjectNameDisplay();
};

// Make change tracking functions globally available
window.markSceneAsChanged = markSceneAsChanged;
window.markSceneAsSaved = markSceneAsSaved;
window.hasUnsavedChanges = () => hasUnsavedChanges;
window.showSaveConfirmationDialog = showSaveConfirmationDialog;
