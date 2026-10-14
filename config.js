/*
  Tetapan log masuk Google untuk selaras data antara peranti (phone dan PC).

  CLIENT_ID ialah OAuth Client ID dari projek Google Cloud akaun peribadi
  fa.rawyadal@gmail.com (Google Auth Platform > Clients), dengan Authorized
  JavaScript origin https://farawyadal.github.io. Client ID bukan rahsia;
  selamat diletak dalam repo public.

  Diecast hanya minta kebenaran drive.appdata: baca dan tulis fail dalam folder
  tersembunyi khas apps ini dalam Google Drive. Ia tak boleh nampak fail lain dalam Drive.
*/
window.DIECAST_CONFIG = {
  CLIENT_ID: '955576045843-541si1cs87t9apl0r5muk5nui00obps1.apps.googleusercontent.com',
};
