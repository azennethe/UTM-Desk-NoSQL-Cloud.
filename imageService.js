import { supabase } from './supabaseClient.js';

/**
 * Sube una imagen al bucket de Supabase Storage
 * @param {File} file - El archivo de imagen proveniente de un input HTML
 * @param {string} folder - Carpeta dentro del bucket (opcional)
 * @returns {Promise<string|null>} - La URL pública de la imagen o null si falla
 */
export async function uploadImage(file, folder = 'uploads') {
  try {
    // Generar un nombre único para evitar sobrescribir archivos con el mismo nombre
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

    // 1. Subir la imagen al bucket llamado 'imagenes'
    // IMPORTANTE: El bucket debe llamarse 'imagenes' en tu panel de Supabase
    const { data, error: uploadError } = await supabase.storage
      .from('imagenes') 
      .upload(filePath, file);

    if (uploadError) throw uploadError;

    // 2. Obtener la URL pública de la imagen
    const { data: { publicUrl } } = supabase.storage
      .from('imagenes')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (error) {
    console.error('Error subiendo imagen a Supabase:', error.message);
    throw error;
  }
}
