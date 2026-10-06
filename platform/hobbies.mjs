export const HOBBIES=['Music','Singing','Dancing','Gaming','Football','Basketball','Tennis','Fitness','Yoga','Running','Cycling','Swimming','Travel','Cooking','Baking','Reading','Writing','Art','Photography','Fashion','Beauty','Movies','Anime','Technology','Cars','Nature','Pets','Board games'];
export const MAX_HOBBIES=6;
// Display only approved choices from profiles saved before the picker existed.
export function storedHobbies(value){let choices;try{choices=JSON.parse(value);}catch{choices=String(value || '').split(',');}if(!Array.isArray(choices))choices=[];return [...new Set(choices.map(x=>HOBBIES.find(h=>h.toLowerCase()===String(x).trim().toLowerCase())).filter(Boolean))].slice(0,MAX_HOBBIES);}
export function validateHobbies(value){if(!Array.isArray(value)||value.length>MAX_HOBBIES||value.some(h=>!HOBBIES.includes(h)))throw Error(`Choose up to ${MAX_HOBBIES} hobbies from the list`);return [...new Set(value)];}
