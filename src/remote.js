import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { io } from 'https://cdn.socket.io/4.4.1/socket.io.esm.min.js';

const modelPath = '/public/Xbot.glb'; // Replace with your model path

const socket = io('https://full-canary-chokeberry.glitch.me/');

let scene, camera, renderer, clock;
let localModel, localMixer;
let currentAction = 'idle';
let localActions = {};
let moveForward = false;
let moveBackward = false;
let rotateLeft = false;
let rotateRight = false;
let lastState = {}; // Track the last known state
const walkSpeed = 2;
const rotateSpeed = Math.PI / 2;
const loadingPlayers = new Set(); // Track players being loaded
const players = {};
let myId = null;

init();
animate();

function init() {
    // Scene setup
    scene = new THREE.Scene();

    scene.background = new THREE.Color(0xa0a0a0);
    scene.fog = new THREE.Fog(0xa0a0a0, 10, 50);

    // Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 100);
    camera.position.set(0, 2, -5);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(10, 50, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    scene.add(dirLight);

    // Grid Ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.MeshPhongMaterial({ color: 0xcbcbcb, depthWrite: false })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true; // Enable ground to receive shadows
    scene.add(ground);

    const gridHelper = new THREE.GridHelper(100, 100, 0x000000, 0x000000);
    gridHelper.material.opacity = 0.25; // Slight transparency for a cleaner look
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Clock
    clock = new THREE.Clock();

    // Load Local Model
    loadLocalModel();

    // Key Events
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Window resize
    window.addEventListener('resize', onWindowResize);

    // Socket setup
    setupSocketEvents();
}

function loadLocalModel() {
    const loader = new GLTFLoader();
    loader.load(
        modelPath,
        (gltf) => {
            localModel = gltf.scene;
            localModel.position.set(0, 0, 0);
            localModel.castShadow = true;
            scene.add(localModel);

            localModel.traverse((object) => {
                if (object.isMesh) object.castShadow = true;
            });

            localModel.add(camera);
            camera.position.set(0, 2, -5);
            camera.lookAt(new THREE.Vector3(0, 2, 0));

            localMixer = new THREE.AnimationMixer(localModel);
            gltf.animations.forEach((clip) => {
                const action = localMixer.clipAction(clip);
                localActions[clip.name] = action;

                if (clip.name === 'idle') {
                    action.play();
                }
            });

            socket.emit('player_joined', { x: 0, z: 0, rotation: 0, action: 'idle' });
        },
        undefined,
        (error) => console.error('Error loading local model:', error)
    );
}

function setupSocketEvents() {
    socket.on('init', (data) => {
        console.log('Init data:', data);
        myId = data.id;
        updatePlayers(data.players);
    });

    socket.on('state_update_all', (data) => {
  

    // Update players and set the last state
    updatePlayers(data);
    lastState = { ...data }; // Clone the new state
});


    socket.on('new_player', (data) => {
        console.log('New Player data:', data);
        addOrUpdatePlayer(data.id, data);
    });

    socket.on('state_update', (data) => {
        console.log('State Update:', data);
        if (players[data.id]) {
            players[data.id].targetX = data.x;
            players[data.id].targetZ = data.z;
            players[data.id].targetRotation = data.rotation || 0;
        }
    });

    socket.on('player_disconnected', (id) => {
        console.log('Player Disconnected:', id);
        removeRemotePlayer(id);
    });
}

function setRemoteAction(id) {
    const player = players[id];
    if (!player) return;

    // Determine action based on motion
    const isMoving = player.position.distanceTo(player.model.position) > 0.01;
    const action = isMoving ? 'walk' : 'idle';

    if (player.currentAction !== action) {
        if (player.actions[player.currentAction]) {
            player.actions[player.currentAction].fadeOut(0.5);
        }
        if (player.actions[action]) {
            player.actions[action].reset().fadeIn(0.5).play();
        }
        player.currentAction = action;
    }
}

function addOrUpdatePlayer(id, data) {
    if (!players[id]) {
        // Create a new remote player
        createRemotePlayer(id, data);
    } else {
        // Update existing remote player
        updateRemotePlayer(id, data);
    }
}
function updateRemotePlayer(id, data) {
    const player = players[id];
    if (!player) return;

    // Update target position and rotation
    player.position.set(data.x, 0, data.z);
    player.rotation = data.rotation;

    // Interpolate position and rotation
    player.model.position.lerp(player.position, 0.1);
    player.model.rotation.y = THREE.MathUtils.lerp(player.model.rotation.y, player.rotation, 0.1);

    // Update animation state based on motion
    setRemoteAction(id);

    // Update animation mixer
    player.mixer.update(clock.getDelta());
}

function createRemotePlayer(id, data) {
    if (players[id] || loadingPlayers.has(id)) {
        console.warn(`Skipping creation for player ${id}. Already exists or is loading.`);
        return;
    }

    loadingPlayers.add(id); // Mark as loading

    const loader = new GLTFLoader();
    loader.load(
        modelPath,
        (gltf) => {
            const remoteModel = gltf.scene;
            remoteModel.position.set(data.x, 0, data.z);
            remoteModel.rotation.y = data.rotation;
            remoteModel.castShadow = true;

            const remoteMixer = new THREE.AnimationMixer(remoteModel);
            const remoteActions = {};
            gltf.animations.forEach((clip) => {
                remoteActions[clip.name] = remoteMixer.clipAction(clip);
            });

            // Start with the idle animation
            if (remoteActions['idle']) {
                remoteActions['idle'].play();
            }

            players[id] = {
                model: remoteModel,
                mixer: remoteMixer,
                actions: remoteActions,
                position: new THREE.Vector3(data.x, 0, data.z),
                rotation: data.rotation,
                currentAction: 'idle', // Track current animation
            };

            scene.add(remoteModel);
            loadingPlayers.delete(id); // Remove from loading set
        },
        undefined,
        (error) => {
            console.error(`Error loading model for player ${id}:`, error);
            loadingPlayers.delete(id); // Ensure the flag is cleared even on error
        }
    );
}


function updatePlayers(playersData) {
    Object.keys(playersData).forEach((id) => {
        if (id !== myId) {
            addOrUpdatePlayer(id, playersData[id]);
        }
    });

    Object.keys(players).forEach((id) => {
        if (!playersData[id]) {
            removeRemotePlayer(id);
        }
    });
}



function removeRemotePlayer(id) {
    if (players[id]) {
        scene.remove(players[id].model);
        delete players[id];
    }
}

function onKeyDown(event) {
    switch (event.key) {
        case 'w':
            moveForward = true;
            setLocalAction('walk');
            break;
        case 's':
            moveBackward = true;
            setLocalAction('walk');
            break;
        case 'a':
            rotateLeft = true;
            break;
        case 'd':
            rotateRight = true;
            break;
    }
}

function onKeyUp(event) {
    switch (event.key) {
        case 'w':
        case 's':
            moveForward = moveBackward = false;
            setLocalAction('idle');
            break;
        case 'a':
            rotateLeft = false;
            break;
        case 'd':
            rotateRight = false;
            break;
    }
}

function setLocalAction(name) {
    if (currentAction !== name) {
        if (localActions[currentAction]) localActions[currentAction].fadeOut(0.5);
        if (localActions[name]) localActions[name].reset().fadeIn(0.5).play();
        currentAction = name;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    if (localMixer) localMixer.update(delta);

    if (localModel) {
        if (moveForward) moveLocalCharacter(1, delta);
        if (moveBackward) moveLocalCharacter(-1, delta);
        if (rotateLeft) rotateLocalCharacter(1, delta);
        if (rotateRight) rotateLocalCharacter(-1, delta);
    }

    Object.values(players).forEach((player) => {
        player.mixer.update(delta);
    });

    renderer.render(scene, camera);
}

function moveLocalCharacter(direction, delta) {
    const forward = new THREE.Vector3(0, 0, direction);
    forward.applyQuaternion(localModel.quaternion);
    localModel.position.add(forward.multiplyScalar(walkSpeed * delta));
    socket.emit('move', { x: localModel.position.x, z: localModel.position.z, rotation: localModel.rotation.y, action: currentAction });
}

function rotateLocalCharacter(direction, delta) {
    localModel.rotation.y += direction * rotateSpeed * delta;
    socket.emit('move', { x: localModel.position.x, z: localModel.position.z, rotation: localModel.rotation.y, action: currentAction });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function isEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!keys2.includes(key) || !isEqual(obj1[key], obj2[key])) return false;
    }

    return true;
}

function areAllEqual(objects) {
    if (objects.length < 2) return true; // Nothing to compare

    const firstObject = objects[0];
    for (let i = 1; i < objects.length; i++) {
        if (!isEqual(firstObject, objects[i])) {
            return false;
        }
    }

    return true;
}

