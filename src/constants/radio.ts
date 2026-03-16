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
    }
];