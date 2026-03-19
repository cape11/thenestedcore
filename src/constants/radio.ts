export interface RadioStation {
    id: string;
    name: string;
    genre: string;
    url: string;
}

export const RADIO_STATIONS: RadioStation[] = [
    {
        id: 'groovesalad',
        name: 'Groove Salad',
        genre: 'Ambient / Downtempo',
        url: 'https://ice1.somafm.com/groovesalad-256-mp3'
    },
    {
        id: 'dronezone',
        name: 'Drone Zone',
        genre: 'Dark Ambient',
        url: 'https://ice1.somafm.com/dronezone-256-mp3'
    },
    {
        id: 'deepspaceone',
        name: 'Deep Space One',
        genre: 'Deep Space Ambient',
        url: 'https://ice1.somafm.com/deepspaceone-256-mp3'
    },
    {
        id: 'secretagent',
        name: 'Secret Agent',
        genre: 'Downtempo / Chill',
        url: 'https://ice1.somafm.com/secretagent-128-mp3'
    },
    {
        id: 'defcon',
        name: 'DEF CON Radio',
        genre: 'Hacking / Electronic',
        url: 'https://ice1.somafm.com/defcon-256-mp3'
    },
    {
        id: 'spacestation',
        name: 'Space Station',
        genre: 'Ambient Electronica',
        url: 'https://ice1.somafm.com/spacestation-128-mp3'
    },
    {
        id: 'thetrip',
        name: 'The Trip',
        genre: 'Progressive House',
        url: 'https://ice1.somafm.com/thetrip-128-mp3'
    },
    {
        id: 'fluid',
        name: 'Fluid',
        genre: 'Electronic / Chill',
        url: 'https://ice1.somafm.com/fluid-128-mp3'
    },
    {
        id: 'beatblender',
        name: 'Beat Blender',
        genre: 'Deep House / Downtempo',
        url: 'https://ice1.somafm.com/beatblender-128-mp3'
    },
    {
        id: 'cliqhop',
        name: 'cliqhop idm',
        genre: 'Intelligent Dance Music',
        url: 'https://ice1.somafm.com/cliqhop-128-mp3'
    }
];