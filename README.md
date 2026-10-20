# PokéSurvivor HUD Suite & Historial (v3.9.5)

[![Versión](https://img.shields.io/badge/version-3.9.5-blue.svg)](https://github.com/ivalactio/pokesurvivor-mod)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-yellow.svg)](manifest.json)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Compatible-brightgreen.svg)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-Compatible-orange.svg)](https://violentmonkey.github.io/)
[![Licencia](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Suite completa de herramientas in-game para **[PokéSurvivor](https://pokesurvivor.com/)**, diseñada con fidelidad visual estilo **Pokémon Mundo Misterioso (PMD)**. Integra minimapa en tiempo real, panel de daño y DPS, editor de interfaz arrastrable, control de FOV dinámico, turbo gacha y registro persistente de partidas con resúmenes compartibles.

---

## 📦 Instalación

### 📦 Instalación (Recomendada: Extensión de Chrome / Brave / Edge)
1. Descarga el repositorio: haz clic en el botón verde **Code** -> **Download ZIP** (o clónalo con git).
2. Descomprime la carpeta en tu equipo.
3. Abre tu navegador y accede a:
   - Chrome / Brave: `chrome://extensions`
   - Edge: `edge://extensions`
4. Activa la casilla **Modo de desarrollador** (arriba a la derecha).
5. Haz clic en el botón **Cargar descomprimida** (Load unpacked).
6. Selecciona la carpeta descomprimida del proyecto (donde están `manifest.json` y `content.js`).
7. ¡Listo! Abre https://pokesurvivor.com y la suite se cargará automáticamente.

### 🔄 Método Alternativo (Tampermonkey / Violentmonkey)
Si prefieres ejecutarlo como UserScript independiente sin instalar la extensión completa:
- Instala [Tampermonkey](https://www.tampermonkey.net/) o [Violentmonkey](https://violentmonkey.github.io/).
- Haz clic en este enlace directo: [Instalar UserScript (Raw)](https://raw.githubusercontent.com/ivalactio/pokesurvivor-mod/main/content.js) y pulsa "Instalar".

---

### 💡 ¿Por qué esta suite? Diseñada para no estorbar

- 🔕 **Control total de la interfaz:** Si en algún momento prefieres una experiencia limpia o jugar sin distracciones, pulsas la tecla **`M`** y todo el HUD del mod se oculta al instante (o la tecla **`B`** / **`N`** para plegar solo el mapa o el panel de daño). La barra de vida y bufos permanecen siempre visibles para mayor seguridad.
- 🏷️ **Minimapa con filtros:** Muestra solo lo que te interesa en cada momento (aliados, cofres, jefes, objetos...) con un simple clic en la leyenda.
- 🔍 **FOV dinámico y natural:** Ajusta el campo de visión en plena partida simplemente usando la rueda del ratón, sin menús intermedios.
- 📜 **Historial compartible:** Tus runs y builds se quedan guardadas automáticamente para que puedas revisarlas o compartir el resumen directamente con tus colegas.

---

## ✨ Funcionalidades Destacadas

* 🗺️ **Minimapa en Tiempo Real**  
  Radar de terreno explorado con detección y seguimiento de entidades: aliados en Co-op, hordas Pokémon, cofres regulares, cofres dorados, manantiales, altares y trampas. Incluye marcadores y avisos visuales diferenciados para **jefes, shinies y ladrones**.

* 🔍 **Control Dinámico de FOV (Cámara)**  
  Ajusta el zoom de visión del campo de batalla cómodamente usando la rueda del ratón (`0.35×` a `2.5×`), permitiendo anticipar oleadas de enemigos. Pulsa la tecla **Fin / End** en cualquier momento para restablecerlo al instante a `1.0×`.

* ⚔️ **Medidor de Daño y DPS**  
  Monitor de daño acumulado y DPS exacto en tiempo real. Incluye ranking de contribución en partidas cooperativas y desglose porcentual del daño infligido por cada uno de tus ataques y habilidades.

* ❤️ **Barra de Vida Personalizable (Editor In-Game)**  
  Barra de vida independiente, escalable y arrastrable a cualquier posición de la pantalla. Ofrece selector de tema en tiempo real:
  - **Clásico PMD**: Estilo caja azul con avatar sprite y medidor segmentado.
  - **Minimalista Nativo**: Barra compacta roja (`#ff5f6d`) con tipografía sombreada y lectura de PS.  
  Compatible tanto en orientación horizontal como vertical.

* ⚡ **Widget de Bufos y Estados Arrastrable**  
  Contenedor HTML propio e independiente para mejoras de estadísticas temporales (`ATK`, `VEL`, `DEF`, `REG`, `AT.E`) y poderes especiales. Diseñado en píldoras con barra de duración dinámica, posición y escala personalizables desde el editor de interfaz in-game.

* 🧼 **Supresión Limpia de HUD Nativo**  
  Intercepta y cancela de forma quirúrgica el renderizado de la barra de vida original del juego y sus cápsulas oscuras de fondo en el canvas, evitando superposiciones o sombras residuales sin afectar el renderizado del mapa. Atenuación automática detrás de menús y modales.

* 📜 **Historial de Runs y Builds Persistente**  
  Registro automático de cada partida finalizada o abandonada en `localStorage`. Guarda tiempo jugado, nivel alcanzado, derrotados, daño total, DPS máximo, objeto equipado, ataques y árbol de pasivas. Incluye botón **📋 Compartir** para copiar un resumen formateado directamente al portapapeles.

* ⏱️ **Timers y Estadísticas Avanzadas**  
  Predicciones de ritmo de subida de nivel, cuenta atrás para la llegada de los **Legendarios (Juicio)**, cálculo de probabilidad y apertura de **Grietas Dimensionales**, además de monitorización de atributos reales (daño multiplicado, reducción %, críticos, regeneración, imán y prisa).

* ⚡ **Turbo Gacha + Tirar Todo**  
  Aceleración opcional de la interfaz de la máquina tragaperras con opción de omitir animaciones lentas y botón **Tirar Todo** para gastar todos los tickets acumulados en un solo clic.

---

## ⌨️ Atajos de Teclado

| Tecla / Acción | Función |
| :--- | :--- |
| <kbd>H</kbd> | Abrir o cerrar el **Modal de Historial** de partidas |
| <kbd>M</kbd> | Ocultar o mostrar todo el **HUD integrado** |
| <kbd>B</kbd> | Plegar o desplegar el panel del **Minimapa** |
| <kbd>N</kbd> | Plegar o desplegar el panel de **Daño y Stats** |
| <kbd>Alt</kbd> + <kbd>J</kbd> | Desplegar u ocultar la sección de **Tus Mejoras y Build** |
| <kbd>Rueda Ratón</kbd> | Ajustar el **FOV / Zoom** de cámara durante la partida |
| <kbd>Fin</kbd> / <kbd>End</kbd> | Restablecer el zoom de cámara a **1.0×** |
| <kbd>Esc</kbd> | Cerrar modales abiertos o salir del Editor de UI |

---

## 📥 Descargas Rápidas

| Opción | Enlace |
| :--- | :--- |
| **Descarga Directa (Extensión Chrome ZIP)** | [⬇️ Descargar pokesurvivor-mod.zip](https://github.com/ivalactio/pokesurvivor-mod/archive/refs/heads/main.zip) |
| **Instalación UserScript (Tampermonkey)** | [⚡ Instalar content.js (Raw)](https://raw.githubusercontent.com/ivalactio/pokesurvivor-mod/main/content.js) |

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
