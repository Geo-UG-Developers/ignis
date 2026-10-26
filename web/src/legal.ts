// Aviso de privacidad y términos de uso de IGNIS. Borrador: lo deben revisar la Universidad
// y la Dra. Farfán antes de publicar en tiendas. Los [corchetes] son datos pendientes.
export const FECHA_LEGAL = '26 de octubre de 2026';

export const PRIVACIDAD = `
<h2>Aviso de privacidad integral</h2>
<p><b>Responsable.</b> El proyecto IGNIS de la Universidad de Guanajuato (GeoUG), a cargo de la Dra. Michelle Farfán,
con domicilio en [domicilio de la Universidad / GeoUG], Guanajuato, Gto., es responsable del uso y protección de tus datos personales.
La app la desarrolla y mantiene GEO UG Developers.</p>
<h3>Qué datos recabamos</h3>
<ul>
<li><b>Al reportar un incendio:</b> ubicación (GPS o la que marques en el mapa), fotografías, tipo de incendio, comentario y, si lo das, tu nombre.</li>
<li><b>De tu dispositivo:</b> un identificador anónimo que crea la app (no usamos tu cuenta de Google o Apple) y, si activas los avisos, el permiso de notificaciones de tu navegador.</li>
</ul>
<p>No recabamos datos personales sensibles ni datos bancarios.</p>
<h3>Para qué los usamos</h3>
<p><b>Finalidades necesarias:</b> hacer llegar tu reporte a la institución que atiende la zona (Bomberos, Protección Civil, CONAFOR u otras),
mostrarte su avance y avisarte cuando cambie.</p>
<p><b>Finalidades adicionales:</b> estadísticas y mapas sin datos que te identifiquen, para investigación de la Universidad, informes a autoridades
y datos abiertos. En los datos abiertos nunca se publica tu nombre.</p>
<h3>Con quién se comparten</h3>
<p>Tu reporte llega a las instituciones de emergencia de la zona por grupos privados de Telegram y por su panel web. Esta transferencia
es para atender la emergencia y no requiere tu consentimiento conforme a la ley. No vendemos ni rentamos tus datos.</p>
<p>La app usa servicios de terceros que guardan la información: Supabase (base de datos y fotos), Telegram (mensajería de las instituciones),
GitHub (alojamiento de la app) y Open-Meteo (clima, solo con tu ubicación aproximada). Estos servicios pueden estar fuera de México.</p>
<h3>Cuánto tiempo los guardamos</h3>
<p>Las fotografías se borran automáticamente a los 6 meses. Tu nombre se elimina de los reportes a los 12 meses; después solo se conservan
datos sin identificarte (tipo, fecha y ubicación del incendio) para estadística e investigación.</p>
<h3>Tus derechos (ARCO)</h3>
<p>Puedes pedir acceso, rectificación, cancelación u oposición al uso de tus datos, o revocar tu consentimiento, escribiendo a
[correo de contacto del proyecto] con tu folio y lo que solicitas. Responderemos en un máximo de 20 días hábiles.</p>
<h3>Cambios a este aviso</h3>
<p>Cualquier cambio se publicará en la sección «Info» de la app. Última actualización: ${FECHA_LEGAL}.</p>`;

export const TERMINOS = `
<h2>Términos de uso</h2>
<p><b>IGNIS no sustituye al 911.</b> Si hay vidas o casas en riesgo, llama primero al 911. Las instituciones atienden según su disponibilidad
y no se garantiza un tiempo de respuesta.</p>
<p><b>Uso responsable.</b> Reporta solo incendios reales. Los reportes falsos distraen a las brigadas; se pueden bloquear y reportar a las autoridades.</p>
<p><b>Tu seguridad primero.</b> No te acerques al fuego ni al humo para tomar fotos.</p>
<p><b>Riesgo de incendio.</b> La tarjeta de riesgo es una estimación con el clima actual y no es un aviso oficial.</p>
<p><b>Servicio gratuito.</b> La app es gratuita, de investigación universitaria, y puede cambiar o suspenderse para mantenimiento. Última actualización: ${FECHA_LEGAL}.</p>`;
