# PokéSurvivor HUD Suite & Historial (v3.8.0)

[![Versión](https://img.shields.io/badge/version-3.8.0-blue.svg)](https://github.com/ivalactio/pokesurvivor-mod)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Compatible-brightgreen.svg)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/Violentmonkey-Compatible-orange.svg)](https://violentmonkey.github.io/)
[![Licencia](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Suite completa de herramientas in-game para **[PokéSurvivor](https://pokesurvivor.com/)**, diseñada con fidelidad visual estilo **Pokémon Mundo Misterioso (PMD)**. Integra minimapa en tiempo real, panel de daño y DPS, editor de interfaz arrastrable, control de FOV dinámico, turbo gacha y registro persistente de partidas con resúmenes compartibles.

---

## 🚀 Instalación Rápida en 1 Clic

### Paso 1: Instala un gestor de UserScripts
Si aún no tienes uno instalado en tu navegador, añade una de estas extensiones:
- [Tampermonkey para Chrome / Brave / Edge](https://www.tampermonkey.net/)
- [Violentmonkey para Firefox / Chrome](https://violentmonkey.github.io/)

### Paso 2: Instala el Script
Haz clic en el siguiente enlace de instalación directa:

[![Instalar en 1 Clic](https://img.shields.io/badge/⚡_INSTALAR_SCRIPT-1--CLIC-success?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/ivalactio/pokesurvivor-mod/main/content.js)

> 👉 **Enlace directo al código:**  
> [https://raw.githubusercontent.com/ivalactio/pokesurvivor-mod/main/content.js](https://raw.githubusercontent.com/ivalactio/pokesurvivor-mod/main/content.js)

Tu gestor de scripts detectará automáticamente la cabecera `==UserScript==` y te mostrará el botón de **Instalar** o **Actualizar**.

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

* 🧼 **Supresión Limpia de HUD Nativo**  
  Intercepta y cancela de forma quirúrgica el renderizado de la barra de vida original del juego y sus cápsulas oscuras de fondo en el canvas, evitando superposiciones o sombras residuales sin afectar el renderizado del mapa.

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

## 🛠️ Desarrollo e Instalación como Extensión Desempaquetada

Si prefieres usarlo como una extensión de navegador independiente en lugar de UserScript:

1. Clona o descarga este repositorio:
   ```bash
   git clone https://github.com/ivalactio/pokesurvivor-mod.git
   ```
2. Abre tu navegador y ve a la página de extensiones:
   - Chrome / Brave / Edge: `chrome://extensions`
3. Activa el **Modo de desarrollador** (arriba a la derecha).
4. Haz clic en **Cargar descomprimida** y selecciona la carpeta del proyecto.
5. Abre [PokéSurvivor](https://pokesurvivor.com/) y disfruta de la experiencia mejorada.

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE).
