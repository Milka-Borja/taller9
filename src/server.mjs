import 'dotenv/config'; // Carga automáticamente las variables de entorno del archivo .env a process.env
import { McpServer } from '@modelcontextprotocol/server'; // Importa la clase para crear un servidor Model Context Protocol (MCP)
import { serveStdio } from '@modelcontextprotocol/server/stdio'; // Importa la herramienta para que el servidor se comunique a través de la terminal (entrada/salida estándar)
import { createClient } from '@supabase/supabase-js'; // Importa la función para conectarse y hacer consultas a la base de datos de Supabase
import * as z from 'zod/v4'; // Importa Zod, una librería para validar estrictamente los datos de entrada

const { EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY } = process.env; // Extrae las credenciales de Supabase de las variables de entorno
if (!EXPO_PUBLIC_SUPABASE_URL || !EXPO_PUBLIC_SUPABASE_KEY) { // Verifica si falta alguna de las dos credenciales necesarias
  console.error('Revisa las variables del archivo .env'); // Si faltan, imprime un error en la consola
  process.exit(1); // Y detiene la ejecución del programa con un código de error (1)
}

const supabase = createClient(EXPO_PUBLIC_SUPABASE_URL, // Inicializa el cliente de Supabase usando la URL del proyecto...
EXPO_PUBLIC_SUPABASE_KEY); // ...y la clave pública (anon key), guardando la conexión en la constante 'supabase'
const estados = ['pendiente', 'en_progreso', 'completada']; // Define un arreglo con los tres estados válidos para filtrar las tareas
const exito = (datos) => ({ // Función auxiliar que recibe los 'datos' de la base de datos y los formatea como respuesta exitosa
  content: [{ type: 'text', text: JSON.stringify(datos, null, 2) }] // Convierte los datos a texto JSON con sangría para que la IA/cliente MCP los entienda
});

function crearServidor(){ // Define la función principal que configurará el servidor MCP
    const server = new McpServer({
        name: 'taller-supabase', version:'1.0.0' // Le asigna un nombre y una versión al servidor para identificarlo
    });
    server.registerTool('listar_tareas', { // Registra una "herramienta" (tool) llamada 'listar_tareas' que la IA podrá usar
        description:'Lista tareas de Supabase; filtra por estado', // Describe qué hace la herramienta para que la IA sepa cuándo usarla
        inputSchema:z.object({
            estado: z.enum(estados).optional(), // El estado debe ser uno de los 3 definidos arriba, pero es opcional (puede no enviarse)
            limite:z.number().int().min(1).max(30).default(10) // El límite debe ser un número entero entre 1 y 30. Si no se envía, por defecto es 10
        })

    }, async({estado, limite})=>{ // Función asíncrona que se ejecuta cuando la herramienta es llamada con 'estado' y 'limite'
        let consulta=supabase.from('tareas_mcp') // Inicia una consulta a la tabla 'tareas_mcp' en Supabase
        .select('id,titulo,estado').order('id').limit(limite); // Pide traer solo id, titulo y estado, ordenados por id, y limitando la cantidad
        if(estado) consulta=consulta.eq('estado', estado); // Si el usuario envió un 'estado', añade un filtro (where estado = valor) a la consulta
        const {data,error}=await consulta; // Ejecuta la consulta en la base de datos de Supabase y extrae los datos o el error
        if (error) return{ // Si ocurrió un error en la base de datos...
            isError:true, // ...devuelve al cliente MCP una bandera indicando que falló
            content:[{type:'text', text:error.message}] // ...e incluye el mensaje del error para saber qué pasó
        };
        return exito(data); // Si no hubo error, formatea los datos con la función 'exito' y los devuelve
    });
    server.registerTool('buscar_tareas', { // Registra una nueva herramienta llamada 'buscar_tareas' en el servidor MCP
      description: 'Busca tareas por texto dentro del título', // Describe la utilidad de la herramienta para que la IA entienda su propósito
      inputSchema: z.object({ // Usa Zod para definir y validar la estructura de los datos de entrada que la herramienta requiere
        texto: z.string().trim().min(2).max(60) // Define que 'texto' debe ser una cadena, elimina espacios a los lados, y exige entre 2 y 60 caracteres
      }) // Cierra la definición del esquema de Zod
    }, async ({ texto }) => { // Inicia la función asíncrona que se ejecuta al usar la herramienta, desestructurando el parámetro 'texto'
       const { data, error } = await supabase // Realiza la petición asíncrona a Supabase y extrae los resultados (data) o un posible fallo (error)
         .from('tareas_mcp') // Especifica que la consulta se realizará sobre la tabla 'tareas_mcp'
         .select('id,titulo,estado') // Pide a la base de datos que solo devuelva las columnas id, titulo y estado
         .ilike('titulo', `%${texto}%`) // Busca coincidencias parciales donde el 'titulo' contenga el 'texto' ingresado (ignorando mayúsculas y minúsculas)
         .order('id').limit(20); // Ordena los resultados devueltos usando la columna 'id' y limita la respuesta a un máximo de 20 registros
       if (error) return { // Comprueba si hubo algún error en la comunicación con Supabase o en la consulta
         isError: true, // Si hubo error, devuelve un indicador de fallo para el cliente o IA que hizo la petición
         content: [{ type: 'text', text: error.message }] // Adjunta el mensaje detallado del error dentro del formato esperado
       }; // Cierra el bloque de manejo de errores
       return exito(data); // Si la consulta fue exitosa, utiliza la función 'exito' (previamente definida) para formatear y devolver los datos
    }); // Cierra la función asíncrona y la declaración de la herramienta 'buscar_tareas'
    server.registerTool('resumen_tareas', { // Registra una nueva herramienta llamada 'resumen_tareas' en el servidor MCP
      description: 'Cuenta cuántas tareas existen por estado', // Describe a la IA que esta herramienta sirve para obtener totales agrupados por estado
      inputSchema: z.object({}) // Define un esquema de entrada vacío con Zod, indicando que la IA no necesita enviar ningún parámetro para usarla
    }, async () => { // Función asíncrona que se ejecuta cuando la herramienta es invocada (no recibe argumentos)
       const conteos = []; // Crea un arreglo vacío para ir almacenando los resultados numéricos de cada estado
       for (const estado of estados) { // Inicia un bucle (loop) para iterar sobre la lista de 'estados' (que definiste antes como pendiente, en_progreso, etc.)
       const { count, error } = await supabase // Hace la consulta asíncrona a Supabase, extrayendo la cantidad (count) y un posible error
         .from('tareas_mcp') // Indica que la consulta se hará en la tabla 'tareas_mcp'
         .select('id', { count: 'exact', head: true }) // Es clave: 'head: true' le dice a Supabase que no devuelva los registros completos, sino únicamente el conteo exacto de filas
         .eq('estado', estado); // Filtra el conteo para que solo cuente las tareas que coincidan con el 'estado' actual del bucle
       if (error) return { // Comprueba si ocurrió algún fallo de red o de base de datos durante la consulta
          isError: true, // Si hay error, le indica al cliente MCP que la ejecución falló
          content: [{ type: 'text', text: error.message }] // Devuelve el mensaje de error de Supabase para que la IA sepa qué salió mal
       }; // Cierra el bloque if del error
       conteos.push({ estado, cantidad: count ?? 0 }); // Si todo fue bien, guarda en el arreglo un objeto con el estado y cuántas tareas hay (si count es null/undefined, pone 0)
    } // Cierra el bucle for
    return exito(conteos); // Tras evaluar todos los estados, usa tu función auxiliar 'exito' para formatear y devolver el arreglo final de conteos a la IA
}); // Cierra la función asíncrona y la declaración de la herramienta 'resumen_tareas'
    return server; // Retorna el servidor completamente configurado con sus herramientas
}

serveStdio(crearServidor); // Inicia el servidor usando el puente de comunicación por consola (stdio) pasándole nuestra función
console.error('Servidor MCP iniciado (studio)') // Imprime un mensaje (usando console.error para no interferir con stdout) avisando que ya está corriendo